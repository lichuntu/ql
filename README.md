# 青龙脚本仓库

## 脚本列表

| 文件 | 说明 | 依赖 |
|---|---|---|
| `ks_duck_loop.js` | 快手「抓鸭刷蛋」无人值守循环版 | 无（仅用 Node 内置 `https` / `fs`） |

---

## 一、拉取脚本

### 方式 1：`ql raw`（推荐，单脚本）

```bash
ql raw https://cdn.jsdelivr.net/gh/lichuntu/ql@main/ks_duck_loop.js
```

拉下来会存到 `/ql/scripts/ks_duck_loop.js`。

### 方式 2：手动 wget（面板机器上直接执行）

```bash
wget -O /ql/scripts/ks_duck_loop.js \
  https://cdn.jsdelivr.net/gh/lichuntu/ql@main/ks_duck_loop.js
```

### 方式 3：Docker 部署的青龙

```bash
docker exec -it ql wget -O /ql/scripts/ks_duck_loop.js \
  https://cdn.jsdelivr.net/gh/lichuntu/ql@main/ks_duck_loop.js
```

> 如果 jsDelivr 拉不动，换镜像：
> `https://ghproxy.net/https://raw.githubusercontent.com/lichuntu/ql/main/ks_duck_loop.js`

---

## 二、环境变量

在青龙面板「环境变量」里添加：

| 变量名 | 必填 | 说明 | 示例 |
|---|---|---|---|
| `KS_CK` | ✅ | 快手 Cookie | `kuaishou.web.cp.api_st=...; userId=...` |
| `KS_TARGET_EGGS` | ❌ | 目标蛋数，默认 2000 | `2000` |
| `KS_MAX_REPORTS` | ❌ | 上报次数上限，默认 10000 | `10000` |
| `KS_ROUND_ID` | ❌ | 指定 roundId（不填自动找） | `4319078205` |
| `KS_GAP` | ❌ | 每次上报间隔 ms，默认 100 | `150` |
| `KS_LEVEL` | ❌ | 关卡号，默认自动探测 | `3` |
| `KS_FAIL_LIMIT` | ❌ | 连续失败上限，默认 10 | `10` |
| `KS_DRY` | ❌ | `1` = 只打印不真跑 | `0` |

---

## 三、定时任务

青龙面板 → 定时任务 → 新建：

- 名称：`快手抓鸭刷蛋`
- 命令：`task ks_duck_loop.js`
- 定时：`0 8 * * *`（每天 8 点，按需改）

> 脚本自带循环和停止条件，一般一天跑一次即可，不必高频。

---

## 四、注意事项

- 脚本会在运行目录写 `.duck-round.json` 缓存 roundId（24 小时有效）
- 失败码 `100000120` = 本局预热不足，脚本会自动补报修正
- 失败码 `109` / `6001` = 登录失效，需要重新取 Cookie
- 首次运行若提示「拿不到 roundId」，在手机上手动点一次「抓鸭」开局再跑
