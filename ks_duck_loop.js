#!/usr/bin/env node
/**
 * 抓鸭刷蛋 · 无人值守循环版
 * ============================================================
 * 核心机制（实测 2026-10-26）：
 *   服务端不校验 level 与开局有效期，用**旧 roundId** 就能无限调 report/duck
 *   每次 report/duck → 鸭鸭币 +10，1000 币自动转 1 颗蛋
 *   token 接口可无限补令牌（不需要次数、不需要重新开局）
 *
 * 所以：只要拿到一个 roundId，就能一直刷，不用管次数。
 *
 * 自动停止条件（任一满足）：
 *   1. 达到目标蛋数（KS_TARGET_EGGS）
 *   2. 达到上报次数上限（KS_MAX_REPORTS）
 *   3. 连续失败 KS_FAIL_LIMIT 次
 *   4. 服务端返回致命错误
 *
 * 用法：
 *   KS_CK='<cookie>' node duck-loop.js
 *   KS_CK='<cookie>' KS_TARGET_EGGS=2000 node duck-loop.js
 *   KS_CK='<cookie>' KS_ROUND_ID=4319078205 node duck-loop.js   # 指定旧 roundId
 *
 * 环境变量：
 *   KS_CK          必填
 *   KS_TARGET_EGGS 目标蛋数，默认 2000
 *   KS_MAX_REPORTS 上报次数上限，默认 10000
 *   KS_ROUND_ID    指定 roundId（不填则自动找一个可用的）
 *   KS_GAP         每次上报间隔 ms，默认 100
 *   KS_HOST        默认 s1-hb1az2-idc-ppg.viviv.com
 *   KS_DRY         1=只打印
 */
'use strict';
const https = require('https');

const rawCK = (process.env.KS_CK || '').trim();
const COOKIE = /#[0-9a-fA-F]{16,64}$/.test(rawCK) ? rawCK.slice(0, rawCK.lastIndexOf('#')) : rawCK;

const CFG = {
  host: (process.env.KS_HOST || 's1-hb1az2-idc-ppg.viviv.com').trim(),
  targetEggs: Number(process.env.KS_TARGET_EGGS || 2000),
  maxReports: Number(process.env.KS_MAX_REPORTS || 10000),
  roundId: (process.env.KS_ROUND_ID || '').trim(),
  gap: Number(process.env.KS_GAP || 100),
  failLimit: Number(process.env.KS_FAIL_LIMIT || 10),
  level: Number(process.env.KS_LEVEL || 3),   // 刷币用的 level：多数号是 3，个别是 2
  dry: process.env.KS_DRY === '1',
};

const CP = { acId: 'growth', gameId: 100, gameVersion: '1.0.3' };
const GP = '/rest/activity/game/common/catch-duck/v2';
const LP = '/rest/n/encourage/game/luckyDuck';
const UA = 'Mozilla/5.0 (Linux; Android 16; 2512BPNDAC) AppleWebKit/537.36 KsWebView/1.8.121.975';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toTimeString().slice(0, 8);
const log = (...a) => console.log(`[${ts()}]`, ...a);

function call(method, host, path, body) {
  if (CFG.dry) return Promise.resolve({ result: 1, data: {} });
  return new Promise((resolve) => {
    const h = {
      'User-Agent': UA, 'Accept': '*/*', 'Cookie': COOKIE,
      'Referer': `https://${host}/doodle/WkGETdhK.html`,
      'Origin': `https://${host}`,
      'X-Requested-With': 'com.kuaishou.nebula',
    };
    // 抓鸭域名需要额外头
    if (host.includes('viviv')) {
      h['YOHOST'] = 'ppg.viviv.com';
      h['ZYCK'] = 'CatchDuck_Assets.CatchDuck_Engine';
    }
    let d = '';
    if (body !== undefined) {
      d = JSON.stringify(body);
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = Buffer.byteLength(d);
    }
    const r = https.request({ host, path, method, headers: h, timeout: 15000 }, (res) => {
      let b = ''; res.on('data', (c) => b += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve(j || { _raw: b.slice(0, 200) }); });
    });
    r.on('timeout', () => { r.destroy(); resolve({ _raw: 'TIMEOUT' }); });
    r.on('error', (e) => resolve({ _raw: 'ERR ' + e.message }));
    if (d) r.write(d);
    r.end();
  });
}
const G = (p, b) => call('POST', CFG.host, GP + p, b);
let WARM_TOKENS = [];   // warmUp 后剩余的令牌，主流程直接用
const N = (p) => call('GET', 'nebula.kuaishou.com', LP + p);

async function readEggs() {
  const r = await N('/statusRefresh');
  if (!r || r.result !== 1) return null;
  return { eggs: r.data.eggAmount || 0, prog: r.data.eggProgressBar || 0 };
}


/** 新 round 必须先报完鸭，才能无限刷币拿蛋；否则 report/duck 返回 100000120 */
async function warmUp(initData) {
  const ri = initData.roundInfo || {};
  const rid = ri.roundId;
  const levels = (initData.gameConfig && initData.gameConfig.levelConfigs) || [];
  const tokens = (ri.nextReportTokens || []).slice();
  let tok = tokens.shift() || '';

  for (const L of levels) {
    const need = L.totalDuckGroupNum || 0;
    for (let i = 0; i < need; i++) {
      if (!tok) tok = tokens.shift();
      if (!tok) break;
      const r = await G('/report/duck', Object.assign({
        roundId: rid, level: L.level, reportToken: tok, leftTimeMs: 470000,
      }, CP));
      if (r.result !== 1) {
        log('  预热 L' + L.level + ' ' + (i + 1) + '/' + need + ' x [' + r.result + '] ' + (r.message || ''));
        break;
      }
      tok = (r.data && r.data.nextReportToken) || tok;
      if (tok) tokens.push(tok);
      await sleep(120);
    }
    log('  预热 L' + L.level + ' 完成 ' + need + ' 只');
  }

  // ★ 关键：必须 success 结算一次，之后 report/duck 才不再校验预热数据
  if (!tok) tok = tokens.shift();
  if (tok) {
    const lastLv = levels.length ? levels[levels.length - 1].level : 1;
    const s = await G('/report/success', Object.assign({
      roundId: rid, level: lastLv, reportToken: tok, leftTimeMs: 5000,
    }, CP));
    if (s.result === 1) {
      log('  结算成功，本局已通关（后续可无限刷）');
      tok = (s.data && s.data.nextReportToken) || '';
      if (tok) tokens.push(tok);
    } else {
      log('  结算失败 [' + s.result + '] ' + (s.message || '') + '（刷币可能仍受校验）');
    }
  }

  // ★ 预热会消耗令牌，刷币前必须补满
  const t = await G('/token', { roundId: rid, tokenNum: 10, ...CP });
  const extra = (t.data && t.data.nextReportTokens) || [];
  tokens.push(...extra);
  log('  预热后补令牌 ' + extra.length + ' 个，剩余池 ' + tokens.length);
  return { tokens, rid };
}

/** 拿一个可用的 roundId：优先用旧的开局记录 */
async function findRoundId() {
  if (CFG.roundId) return CFG.roundId;

  // 1) 试着 init 一次（有新次数就拿到新 round）
  const init = await G('/init', Object.assign({ requestId: String(Date.now()) }, CP));
  if (init.result === 1 && init.data && init.data.roundInfo) {
    const rid = init.data.roundInfo.roundId;
    log(`开局成功，新 roundId=${rid}`);
    const w = await warmUp(init.data);   // ★ 先报完鸭并补令牌
    WARM_TOKENS = (w && w.tokens) || [];
    return rid;
  }
  log(`init 不可用 [${init.result}] ${init.message || ''}，尝试复用旧 roundId`);

  // 2) 从战绩接口猜不到，只能要求用户提供或用上次缓存
  const cache = './.duck-round.json';
  try {
    const fs = require('fs');
    if (fs.existsSync(cache)) {
      const j = JSON.parse(fs.readFileSync(cache, 'utf8'));
      if (j.roundId && Date.now() - j.ts < 86400000) {
        log(`使用缓存 roundId=${j.roundId}`);
        return j.roundId;
      }
    }
  } catch (_) {}
  return '';
}

function saveRoundId(rid) {
  try {
    require('fs').writeFileSync('./.duck-round.json', JSON.stringify({ roundId: rid, ts: Date.now() }));
  } catch (_) {}
}

(async () => {
  if (!COOKIE) { console.error('缺少 KS_CK'); process.exit(2); }
  log(`无人值守模式 目标=${CFG.targetEggs}蛋 上限=${CFG.maxReports}次 间隔=${CFG.gap}ms`);

  const b0 = await readEggs();
  if (!b0) { log('预检失败：Cookie 无效或未授权'); process.exit(1); }
  log(`开局：鸭蛋=${b0.eggs} 进度=${b0.prog}%`);

  const rid = await findRoundId();
  if (!rid) {
    log('拿不到 roundId：请在手机上点一次「抓鸭」开局，或设置 KS_ROUND_ID');
    log('  KS_ROUND_ID 可以从抓包 init 响应里拿，或者用上次的值');
    process.exit(1);
  }
  saveRoundId(rid);
  log(`使用 roundId=${rid}  开始刷`);

  let queue = WARM_TOKENS.slice();
  let reports = 0, eggs = b0.eggs, coins = 0, fail = 0, stop = '';

  // ★ 自动探测可用 level（不同号关卡号不同）
  if (!process.env.KS_LEVEL) {
    for (const lv of [3, 2, 1]) {
      if (queue.length < 3) {
        const t = await G('/token', { roundId: rid, tokenNum: 10, ...CP });
        queue = queue.concat((t.data && t.data.nextReportTokens) || []);
      }
      const tk = queue.shift();
      if (!tk) continue;
      const r = await G('/report/duck', { roundId: rid, level: lv, reportToken: tk, leftTimeMs: 470000, ...CP });
      if (r.result === 1) {
        CFG.level = lv;
        reports++;   // 这次也算一次有效上报
        if (r.data && r.data.nextReportToken) queue.push(r.data.nextReportToken);
        const ci = (r.data && r.data.coinInfo) || {};
        if (ci.totalCoinNum !== undefined) coins = ci.totalCoinNum;
        log(`探测到可用 level=${lv}（已上报 1 次，币 ${coins}）`);
        break;
      }
      await sleep(200);
    }
  }
  log(`刷币使用 level=${CFG.level}`);

  while (reports < CFG.maxReports) {
    // 目标达成
    if (eggs >= CFG.targetEggs) { stop = `达到目标 ${CFG.targetEggs} 蛋`; break; }

    // 补令牌
    if (queue.length < 2) {
      const t = await G('/token', { roundId: rid, tokenNum: 10, ...CP });
      const add = (t.data && t.data.nextReportTokens) || [];
      if (!add.length) {
        fail++;
        log(`补令牌失败 [${t.result}] ${t.message || ''}（${fail}/${CFG.failLimit}）`);
        if (fail >= CFG.failLimit) { stop = '令牌持续失败'; break; }
        await sleep(3000);
        continue;
      }
      queue = queue.concat(add);
      fail = 0;
    }

    const tk = queue.shift();
    const r = await G('/report/duck', {
      roundId: rid, level: CFG.level, reportToken: tk, leftTimeMs: 470000, ...CP,
    });

    if (r.result !== 1) {
      fail++;
      const c = r.result;
      if (fail <= 3) log(`  上报失败 [${c}] ${r.message || ''}`);

      // 100000120 = 本局数据校验未通过（预热不足）
      // 兜底：补报 level 1 + 2 各一只后再继续
      if (c === 100000120 && fail <= 3) {
        log('    检测到 100000120，补报 level 1/2 修正');
        const t = await G('/token', { roundId: rid, tokenNum: 5, ...CP });
        const fix = (t.data && t.data.nextReportTokens) || [];
        const tryLv = [CFG.level, 1, 2, 3].filter((v, i, a) => a.indexOf(v) === i);
        for (const lv of tryLv) {
          if (!fix.length) break;
          const rr = await G('/report/duck', {
            roundId: rid, level: lv, reportToken: fix.shift(), leftTimeMs: 470000, ...CP,
          });
          log('    补报 L' + lv + ' → ' + rr.result + ' ' + (rr.message || ''));
          if (rr.result === 1 && rr.data && rr.data.nextReportToken) fix.push(rr.data.nextReportToken);
          await sleep(150);
        }
        await sleep(300);
        continue;
      }

      if (c === 100000112) { await sleep(2000); continue; }
      if (c === 109 || c === 6001) { stop = '登录失效'; break; }
      if (fail >= CFG.failLimit) { stop = `连续失败 ${fail} 次`; break; }
      await sleep(1000);
      continue;
    }

    fail = 0;
    reports++;
    if (r.data && r.data.nextReportToken) queue.push(r.data.nextReportToken);
    const ci = (r.data && r.data.coinInfo) || {};
    const prevCoins = coins;
    if (ci.totalCoinNum !== undefined) coins = ci.totalCoinNum;

    // 币突然变小 = 触发换蛋，读真实余额确认
    if (prevCoins > coins + 500) {
      const bal = await readEggs();
      if (bal) {
        const prev = eggs;
        eggs = bal.eggs;
        log(`★ 第 ${reports} 次上报换到蛋：币 ${prevCoins}→${coins}，蛋 ${prev} → ${eggs}`);
      }
    } else if (reports % 50 === 0) {
      log(`  ${reports} 次上报，币 ${coins}，目标 ${CFG.targetEggs} 蛋`);
    }
    await sleep(CFG.gap);
  }

  const b1 = await readEggs();
  log('\n══════ 结束 ══════');
  log(`结束原因：${stop || '达到上报上限'}`);
  log(`上报 ${reports} 次`);
  log(`鸭蛋 ${b0.eggs} → ${b1 ? b1.eggs : '?'}  净增 ${b1 ? b1.eggs - b0.eggs : '?'}`);
  log(`剩余币 ${coins}`);
  process.exit(0);
})();
