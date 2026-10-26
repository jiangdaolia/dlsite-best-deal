import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../userscript/dl-price-tracker.user.js", import.meta.url),
  "utf8",
);

// 与 language-edition.test.mjs 相同：按函数名截取源码，直到下一个同级 function。
function functionSource(name) {
  const result = source.match(new RegExp(
    `  (?:async )?function ${name}\\([\\s\\S]*?(?=\\n  (?:async )?function )`,
  ));
  if (!result) throw new Error(`${name} not found`);
  return result[0];
}

const LOCK_KEY = "dltracker-account-index-lock-v1";

function makeLocalStorage(store) {
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

function createTab({ tabId, store, clock, rand }) {
  const localStorage = makeLocalStorage(store);
  const sandbox = {
    localStorage,
    nowMs: () => clock.value,
    randFn: rand,
    dealNumber(value, fallback = 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
  };
  vm.runInNewContext(
    `
    const ACCOUNT_INDEX_LOCK_STORAGE_KEY = ${JSON.stringify(LOCK_KEY)};
    const ACCOUNT_INDEX_LOCK_TTL_MS = 60 * 1000;
    let accountIndexTabId = ${JSON.stringify(tabId)};
    let accountLockClaim = null;
    Date.now = () => nowMs();
    Math.random = () => randFn();
    ${functionSource("loadAccountIndexLock")}
    ${functionSource("accountIndexLockIsActive")}
    ${functionSource("accountIndexForeignReadActive")}
    ${functionSource("accountLockRecordIsNewer")}
    ${functionSource("accountIndexLockHeldBy")}
    ${functionSource("beginAccountLockClaim")}
    ${functionSource("writeAccountIndexLock")}
    ${functionSource("commitAccountIndexLock")}
    ${functionSource("acquireAccountIndexLock")}
    ${functionSource("renewAccountIndexLock")}
    ${functionSource("releaseAccountIndexLock")}
    globalThis.lockApi = {
      loadAccountIndexLock,
      accountIndexLockIsActive,
      accountIndexForeignReadActive,
      accountLockRecordIsNewer,
      accountIndexLockHeldBy,
      acquireAccountIndexLock,
      renewAccountIndexLock,
      releaseAccountIndexLock,
      setClaim(value) { accountLockClaim = value; },
      getClaim() { return accountLockClaim; },
    };
    `,
    sandbox,
  );
  return sandbox.lockApi;
}

function readLock(store) {
  return JSON.parse(store.get(LOCK_KEY));
}

test("手动接管：旧页面续约失败、释放不会删掉新主人的锁", () => {
  const store = new Map();
  const clock = { value: 1_000_000 };
  let seed = 0.1;
  const tabA = createTab({ tabId: "tab-a", store, clock, rand: () => seed });
  const tabB = createTab({ tabId: "tab-b", store, clock, rand: () => seed + 0.5 });

  const claimA = tabA.acquireAccountIndexLock();
  assert.ok(claimA, "A 应能拿到空锁");
  tabA.setClaim(claimA);
  assert.equal(readLock(store).owner, "tab-a");

  // 不带 takeover：被外来活跃锁挡住。
  clock.value += 1000;
  assert.equal(tabB.acquireAccountIndexLock(), null);

  // 手动接管：拿到锁，owner 换成 B。
  const claimB = tabB.acquireAccountIndexLock({ takeover: true });
  assert.ok(claimB, "B 应能接管");
  tabB.setClaim(claimB);
  assert.equal(readLock(store).owner, "tab-b");

  // A 的续约必须失败，且不能把锁写回自己。
  clock.value += 1000;
  assert.equal(tabA.renewAccountIndexLock(claimA), false);
  assert.equal(readLock(store).owner, "tab-b");

  // A 释放时不能删掉 B 的锁。
  tabA.releaseAccountIndexLock(claimA);
  assert.equal(readLock(store).owner, "tab-b");
  assert.equal(tabB.renewAccountIndexLock(claimB), true);
});

test("同毫秒并发：令牌定序，输的一方续约失败且不覆盖赢家", () => {
  const store = new Map();
  const clock = { value: 2_000_000 };
  const tabA = createTab({ tabId: "tab-a", store, clock, rand: () => 0.1 });
  const tabB = createTab({ tabId: "tab-b", store, clock, rand: () => 0.9 });

  const claimA = tabA.acquireAccountIndexLock();
  tabA.setClaim(claimA);
  // 同一毫秒内 B 接管：token 更大的一方获胜。
  const claimB = tabB.acquireAccountIndexLock({ takeover: true });
  assert.ok(claimB, "B 的声明更新，应接管成功");
  tabB.setClaim(claimB);
  assert.equal(readLock(store).owner, "tab-b");

  assert.equal(tabA.renewAccountIndexLock(claimA), false);
  assert.equal(tabB.renewAccountIndexLock(claimB), true);
  assert.equal(readLock(store).owner, "tab-b");
});

test("兼容旧记录：没有 takenAt/token 的锁可被直接接管", () => {
  const store = new Map();
  const clock = { value: 3_000_000 };
  store.set(LOCK_KEY, JSON.stringify({
    owner: "legacy-tab",
    expiresAt: clock.value + 30_000,
  }));
  const tab = createTab({ tabId: "tab-new", store, clock, rand: () => 0.5 });
  assert.equal(readLock(store).takenAt, undefined);
  assert.equal(tab.acquireAccountIndexLock(), null, "旧记录仍算活跃外来锁");
  const claim = tab.acquireAccountIndexLock({ takeover: true });
  assert.ok(claim);
  tab.setClaim(claim);
  assert.equal(readLock(store).owner, "tab-new");
});

test("过期锁不需要 takeover 也能获取；续约只延后过期时间", () => {
  const store = new Map();
  const clock = { value: 4_000_000 };
  store.set(LOCK_KEY, JSON.stringify({
    owner: "stale-tab",
    token: "stale",
    takenAt: clock.value - 120_000,
    expiresAt: clock.value - 1,
  }));
  const tab = createTab({ tabId: "tab-a", store, clock, rand: () => 0.3 });
  const claim = tab.acquireAccountIndexLock();
  assert.ok(claim, "过期锁可直接获取");
  tab.setClaim(claim);
  const first = readLock(store);
  assert.equal(first.owner, "tab-a");

  clock.value += 5_000;
  assert.equal(tab.renewAccountIndexLock(claim), true);
  const renewed = readLock(store);
  assert.equal(renewed.takenAt, first.takenAt, "续约不改变 takenAt");
  assert.ok(renewed.expiresAt > first.expiresAt, "续约延长 expiresAt");
});

test("旧页面迟到写入：赢家仍视为持锁，并在下次续约盖回", () => {
  const store = new Map();
  const clock = { value: 5_000_000 };
  const tabA = createTab({ tabId: "tab-a", store, clock, rand: () => 0.1 });
  const tabB = createTab({ tabId: "tab-b", store, clock, rand: () => 0.6 });

  const claimA = tabA.acquireAccountIndexLock();
  tabA.setClaim(claimA);
  clock.value += 1000;
  const claimB = tabB.acquireAccountIndexLock({ takeover: true });
  tabB.setClaim(claimB);

  // 模拟 A 迟到的旧写入（比 B 的声明更旧）。
  store.set(LOCK_KEY, JSON.stringify({
    owner: "tab-a",
    token: claimA.token,
    takenAt: claimA.takenAt,
    expiresAt: clock.value + 30_000,
  }));
  assert.equal(tabB.accountIndexLockHeldBy(claimB), true, "更旧的记录不算被抢");
  clock.value += 1000;
  assert.equal(tabB.renewAccountIndexLock(claimB), true);
  assert.equal(readLock(store).owner, "tab-b");
});

// 崩溃（渲染进程被系统强杀）与「正常关闭」的区别：没有 pagehide、没有释放、
// 也没有 storage 事件。接管必须完全不依赖上一页还活着。
test("另一页崩溃：不续约也不释放，本页照样能接管和续约", () => {
  const store = new Map();
  const clock = { value: 6_000_000 };
  const deadTab = createTab({ tabId: "tab-dead", store, clock, rand: () => 0.2 });
  deadTab.setClaim(deadTab.acquireAccountIndexLock());
  assert.equal(readLock(store).owner, "tab-dead");

  // 此后崩溃页再没有任何动作：不续约、不释放、不发事件。
  const liveTab = createTab({ tabId: "tab-live", store, clock, rand: () => 0.7 });
  clock.value += 3_000;
  const claimLive = liveTab.acquireAccountIndexLock({ takeover: true });
  assert.ok(claimLive, "崩溃页没释放的活跃租约不应挡住接管");
  liveTab.setClaim(claimLive);
  assert.equal(readLock(store).owner, "tab-live");
  clock.value += 5_000;
  assert.equal(liveTab.renewAccountIndexLock(claimLive), true);

  // 租约自然过期后，新页面连 takeover 都不用。
  clock.value += 120_000;
  const freshTab = createTab({ tabId: "tab-fresh", store, clock, rand: () => 0.9 });
  const claimFresh = freshTab.acquireAccountIndexLock();
  assert.ok(claimFresh, "崩溃页的租约过期后应能直接获取");
  freshTab.setClaim(claimFresh);
  assert.equal(readLock(store).owner, "tab-fresh");
});

function createWatchTab({ tabId, store, clock }) {
  const timers = [];
  const state = { refreshes: 0 };
  let seq = 0;
  const sandbox = {
    localStorage: makeLocalStorage(store),
    nowMs: () => clock.value,
    setTimeout(fn, delay) {
      seq += 1;
      timers.push({ id: seq, fn, delay });
      return seq;
    },
    clearTimeout(id) {
      const index = timers.findIndex((item) => item.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    refreshAccountInformationPanels() {
      state.refreshes += 1;
    },
    dealNumber(value, fallback = 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
  };
  vm.runInNewContext(
    `
    const ACCOUNT_INDEX_LOCK_STORAGE_KEY = ${JSON.stringify(LOCK_KEY)};
    let accountIndexTabId = ${JSON.stringify(tabId)};
    let accountLockExpiryWatchTimer = null;
    Date.now = () => nowMs();
    ${functionSource("loadAccountIndexLock")}
    ${functionSource("accountIndexLockIsActive")}
    ${functionSource("accountIndexForeignReadActive")}
    ${functionSource("watchAccountLockExpiry")}
    globalThis.watchApi = {
      watch: watchAccountLockExpiry,
      pending: () => accountLockExpiryWatchTimer,
    };
    `,
    sandbox,
  );
  return {
    watch: sandbox.watchApi.watch,
    timers,
    state,
    peek: () => sandbox.watchApi.pending(),
    fire() {
      const timer = timers.shift();
      if (!timer) throw new Error("没有待触发的定时器");
      timer.fn();
      return timer;
    },
  };
}

test("崩溃页留下的租约：到期自动重绘，对方续约则继续等待", () => {
  const store = new Map();
  const clock = { value: 7_000_000 };
  const expiresAt = clock.value + 5_000;
  store.set(LOCK_KEY, JSON.stringify({
    owner: "tab-dead",
    token: "dead",
    takenAt: clock.value - 1_000,
    expiresAt,
  }));
  const watcher = createWatchTab({ tabId: "tab-live", store, clock });
  assert.equal(watcher.peek(), null, "还没重绘过，不应有定时器");

  watcher.watch();
  assert.equal(watcher.timers.length, 1);
  assert.ok(watcher.timers[0].delay >= 5_000, "应等到租约过期再唤醒");
  assert.equal(watcher.state.refreshes, 0);

  // 到期那一刻锁已经无效 → 重绘成可读取，且不再循环。
  clock.value = expiresAt + 1;
  watcher.fire();
  assert.equal(watcher.state.refreshes, 1);
  assert.equal(watcher.timers.length, 0);
  assert.equal(watcher.peek(), null);

  // 对方还活着、又续了一次约：不重绘，只等下一次过期。
  store.set(LOCK_KEY, JSON.stringify({
    owner: "tab-dead",
    token: "dead",
    takenAt: clock.value,
    expiresAt: clock.value + 60_000,
  }));
  watcher.watch();
  assert.equal(watcher.timers.length, 1);
  clock.value += 5_000;
  store.set(LOCK_KEY, JSON.stringify({
    owner: "tab-dead",
    token: "dead",
    takenAt: clock.value - 5_000,
    expiresAt: clock.value + 60_000,
  }));
  watcher.fire();
  assert.equal(watcher.state.refreshes, 1, "对方仍在读时不重绘");
  assert.equal(watcher.timers.length, 1, "应继续等待下一次过期");

  // 没有外来租约时什么都不安排。
  store.delete(LOCK_KEY);
  watcher.watch();
  assert.equal(watcher.timers.length, 0);
});

test("账号请求登记表：同轮全部中止，旧轮不污染新轮", () => {
  class FakeController {
    constructor() {
      this.aborted = false;
    }
    abort() {
      this.aborted = true;
    }
  }
  const sandbox = {
    APP_NAME: "test",
    dealSessionStopped: false,
    controllerSeed: [],
  };
  vm.runInNewContext(
    `
    let accountIndexSessionStopped = false;
    let accountIndexSessionStopReason = "";
    let accountSessionEpoch = 0;
    let dealSessionStopped = false;
    const accountRequestControllers = new Set();
    function stopDealRequests() { dealSessionStopped = true; }
    ${functionSource("requestSessionStopped")}
    ${functionSource("trackAccountRequest")}
    ${functionSource("untrackAccountRequest")}
    ${functionSource("abortAccountRequests")}
    ${functionSource("stopRequestSession")}
    ${functionSource("beginAccountSession")}
    globalThis.requestApi = {
      trackAccountRequest,
      untrackAccountRequest,
      abortAccountRequests,
      stopRequestSession,
      beginAccountSession,
      requestSessionStopped,
      getEpoch() { return accountSessionEpoch; },
    };
    `,
    sandbox,
  );
  const api = sandbox.requestApi;
  const first = new FakeController();
  const second = new FakeController();
  api.trackAccountRequest(first, 0);
  api.trackAccountRequest(second, 0);

  api.stopRequestSession("account", "接手");
  assert.equal(first.aborted, true);
  assert.equal(second.aborted, true);
  assert.equal(api.requestSessionStopped("account"), true);

  // 新一轮：清空旧控制器、epoch 前进、会话恢复。
  api.beginAccountSession();
  assert.equal(api.getEpoch(), 1);
  assert.equal(api.requestSessionStopped("account"), false);

  const current = new FakeController();
  api.trackAccountRequest(current, 1);
  // 旧 epoch 的迟到失败不得改写当前会话。
  api.stopRequestSession("account", "late", { epoch: 0 });
  assert.equal(api.requestSessionStopped("account"), false);
  assert.equal(current.aborted, false);

  api.stopRequestSession("account", "当前轮", { epoch: 1 });
  assert.equal(current.aborted, true);
  assert.equal(api.requestSessionStopped("account"), true);
});
