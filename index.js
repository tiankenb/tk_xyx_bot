{
  "name": "telegram-farm-bot",
  "version": "1.0.0",
  "description": "QQ农场风格Telegram机器人",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js"
  },
  "dependencies": {
    "telegraf": "^4.16.3",
    "dotenv": "^16.4.5",
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "nodemon": "^3.1.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}# Telegram Bot Token (从 @BotFather 获取)
BOT_TOKEN=YOUR_BOT_TOKEN_HERE

# 可选: 生产环境使用Redis存储
REDIS_URL=your_redis_url_here

# 农场配置 (可选)
CROP_GROW_TIME=60000      # 作物成熟时间 (毫秒)
BUG_PENALTY=30000         # 虫子延迟时间 (毫秒)
ROWS=4
COLS=4
require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const { createFarm, renderFarm, handleCallback } = require('./farmLogic');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ 请设置 BOT_TOKEN 环境变量');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// 会话中间件 (存储用户状态)
bot.use(session());

// 启动命令
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    createFarm(userId);
    await ctx.reply('🌾 欢迎来到QQ农场机器人版！\n点击下方按钮开始经营你的农场。');
    await renderFarm(ctx, userId);
});

// 处理所有回调查询
bot.on('callback_query', async (ctx) => {
    await handleCallback(ctx);
});

// 错误处理
bot.catch((err, ctx) => {
    console.error('Bot错误:', err);
    ctx.reply('⚠️ 发生错误，请稍后重试');
});

// 启动机器人
bot.launch()
    .then(() => console.log('🤖 农场机器人已启动！'))
    .catch(err => console.error('启动失败:', err));

// 优雅关闭
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;
const { Markup } = require('telegraf');

// 配置 (可从环境变量读取)
const ROWS = parseInt(process.env.ROWS) || 4;
const COLS = parseInt(process.env.COLS) || 4;
const CROP_GROW_TIME = parseInt(process.env.CROP_GROW_TIME) || 60000;
const BUG_PENALTY = parseInt(process.env.BUG_PENALTY) || 30000;

// 内存存储 (生产环境建议使用Redis)
const userFarms = new Map();

// 创建空农场
function createEmptyFarm() {
    const farm = [];
    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
            row.push({
                state: 'empty',
                bug: false,
                growTimer: null,
                bugTimer: null,
            });
        }
        farm.push(row);
    }
    return farm;
}

// 获取或创建用户农场
function getOrCreateFarm(userId) {
    if (!userFarms.has(userId)) {
        userFarms.set(userId, {
            farm: createEmptyFarm(),
            userId: userId,
        });
    }
    return userFarms.get(userId);
}

// 清除定时器
function clearCellTimers(userData, row, col) {
    const cell = userData.farm[row][col];
    if (cell.growTimer) {
        clearTimeout(cell.growTimer);
        cell.growTimer = null;
    }
    if (cell.bugTimer) {
        clearTimeout(cell.bugTimer);
        cell.bugTimer = null;
    }
}

// 种植作物
function plantCrop(userData, row, col) {
    const cell = userData.farm[row][col];
    if (cell.state !== 'empty' || cell.bug) return false;

    clearCellTimers(userData, row, col);
    cell.state = 'growing';
    cell.bug = false;

    const timer = setTimeout(() => {
        const current = userData.farm[row]?.[col];
        if (!current || current.state !== 'growing') return;
        
        if (current.bug) {
            const bugTimer = setTimeout(() => {
                const c2 = userData.farm[row]?.[col];
                if (c2 && c2.state === 'growing') {
                    c2.state = 'ready';
                    c2.growTimer = null;
                    // 通知用户 (通过bot实例)
                    const bot = require('./index');
                    bot.telegram.sendMessage(userData.userId, 
                        `🍓 作物 (${row+1},${col+1}) 成熟了！`);
                }
            }, BUG_PENALTY);
            current.bugTimer = bugTimer;
            return;
        }
        current.state = 'ready';
        current.growTimer = null;
        const bot = require('./index');
        bot.telegram.sendMessage(userData.userId, 
            `🍓 作物 (${row+1},${col+1}) 成熟了！`);
    }, CROP_GROW_TIME);
    cell.growTimer = timer;
    return true;
}

// 收获所有成熟作物
function harvestAll(userData) {
    let count = 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = userData.farm[r][c];
            if (cell.state === 'ready') {
                clearCellTimers(userData, r, c);
                userData.farm[r][c] = { state: 'empty', bug: false, growTimer: null, bugTimer: null };
                count++;
            }
        }
    }
    return count;
}

// 偷菜
function stealCrop(userData) {
    const ready = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (userData.farm[r][c].state === 'ready') ready.push({r, c});
        }
    }
    if (ready.length === 0) return false;
    const target = ready[Math.floor(Math.random() * ready.length)];
    clearCellTimers(userData, target.r, target.c);
    userData.farm[target.r][target.c] = { state: 'empty', bug: false, growTimer: null, bugTimer: null };
    return true;
}

// 放虫
function releaseBug(userData) {
    const growing = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = userData.farm[r][c];
            if (cell.state === 'growing' && !cell.bug) growing.push({r, c});
        }
    }
    if (growing.length === 0) return false;
    const target = growing[Math.floor(Math.random() * growing.length)];
    const cell = userData.farm[target.r][target.c];
    if (cell.bug) return false;

    clearCellTimers(userData, target.r, target.c);
    cell.bug = true;
    const remaining = CROP_GROW_TIME + BUG_PENALTY;
    const timer = setTimeout(() => {
        const current = userData.farm[target.r]?.[target.c];
        if (!current || current.state !== 'growing') return;
        if (current.bug) {
            const bugTimer2 = setTimeout(() => {
                const c2 = userData.farm[target.r]?.[target.c];
                if (c2 && c2.state === 'growing') {
                    c2.state = 'ready';
                    c2.bug = false;
                    c2.growTimer = null;
                    const bot = require('./index');
                    bot.telegram.sendMessage(userData.userId, 
                        `🍓 被虫咬过的作物 (${target.r+1},${target.c+1}) 终于成熟了！`);
                }
            }, BUG_PENALTY);
            current.bugTimer = bugTimer2;
            return;
        }
        current.state = 'ready';
        current.bug = false;
        current.growTimer = null;
        const bot = require('./index');
        bot.telegram.sendMessage(userData.userId, 
            `🍓 作物 (${target.r+1},${target.c+1}) 成熟了！`);
    }, remaining);
    cell.growTimer = timer;
    return true;
}

// 渲染农场键盘
function renderFarm(ctx, userId) {
    const userData = getOrCreateFarm(userId);
    const farm = userData.farm;
    
    let text = '🌾 *你的农场* 🌾\n\n';
    let ready = 0, bugs = 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (farm[r][c].state === 'ready') ready++;
            if (farm[r][c].bug) bugs++;
        }
    }
    text += `🌱 成熟: ${ready}  |  🐛 虫子: ${bugs}\n\n`;

    // 绘制网格
    for (let r = 0; r < ROWS; r++) {
        let rowText = '';
        for (let c = 0; c < COLS; c++) {
            const cell = farm[r][c];
            let emoji = '⬜';
            if (cell.state === 'growing') emoji = '🌱';
            else if (cell.state === 'ready') emoji = '🍓';
            if (cell.bug) emoji = '🐛' + emoji;
            rowText += emoji + ' ';
        }
        text += rowText + '\n';
    }

    // 构建按钮
    const buttons = [];
    for (let r = 0; r < ROWS; r++) {
        const rowButtons = [];
        for (let c = 0; c < COLS; c++) {
            const cell = farm[r][c];
            let label = '⬜';
            if (cell.state === 'growing') label = '🌱';
            else if (cell.state === 'ready') label = '🍓';
            if (cell.bug) label = '🐛' + label;
            rowButtons.push(Markup.button.callback(label, `cell_${r}_${c}`));
        }
        buttons.push(rowButtons);
    }

    const actionButtons = [
        Markup.button.callback('🌱 播种', 'action_plant'),
        Markup.button.callback('🧺 收获', 'action_harvest'),
        Markup.button.callback('🦊 偷菜', 'action_steal'),
        Markup.button.callback('🐛 放虫', 'action_bug'),
    ];
    const actionRows = [
        actionButtons.slice(0, 2),
        actionButtons.slice(2, 4),
    ];

    const keyboard = Markup.inlineKeyboard([...buttons, ...actionRows]);

    if (ctx.callbackQuery) {
        return ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            ...keyboard,
            disable_web_page_preview: true,
        });
    } else {
        return ctx.reply(text, {
            parse_mode: 'Markdown',
            ...keyboard,
            disable_web_page_preview: true,
        });
    }
}

// 处理回调
async function handleCallback(ctx) {
    const userId = ctx.from.id;
    const data = ctx.callbackQuery.data;
    const userData = getOrCreateFarm(userId);

    if (data.startsWith('cell_')) {
        const parts = data.split('_');
        const row = parseInt(parts[1]);
        const col = parseInt(parts[2]);
        const cell = userData.farm[row][col];
        
        if (cell.state === 'empty' && !cell.bug) {
            const success = plantCrop(userData, row, col);
            if (success) {
                await ctx.answerCbQuery('🌱 播种成功！');
                await renderFarm(ctx, userId);
            } else {
                await ctx.answerCbQuery('❌ 无法播种');
            }
        } else {
            let msg = `📍 (${row+1},${col+1}) 状态: `;
            if (cell.state === 'growing') msg += '生长中 🌱';
            else if (cell.state === 'ready') msg += '已成熟 🍓';
            else msg += '空地 🌿';
            if (cell.bug) msg += '  (有虫子🐛)';
            await ctx.answerCbQuery(msg, { show_alert: true });
        }
    } else if (data === 'action_plant') {
        let planted = 0;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (planted >= 2) break;
                const cell = userData.farm[r][c];
                if (cell.state === 'empty' && !cell.bug) {
                    if (plantCrop(userData, r, c)) planted++;
                }
            }
            if (planted >= 2) break;
        }
        if (planted === 0) {
            await ctx.answerCbQuery('⚠️ 没有空地可以播种', { show_alert: true });
        } else {
            await ctx.answerCbQuery(`🌱 播种了 ${planted} 块地`);
            await renderFarm(ctx, userId);
        }
    } else if (data === 'action_harvest') {
        const count = harvestAll(userData);
        if (count === 0) {
            await ctx.answerCbQuery('🌾 没有成熟的作物', { show_alert: true });
        } else {
            await ctx.answerCbQuery(`🧺 收获了 ${count} 个果实`);
            await renderFarm(ctx, userId);
        }
    } else if (data === 'action_steal') {
        const success = stealCrop(userData);
        if (!success) {
            await ctx.answerCbQuery('🦊 没有成熟的作物可偷', { show_alert: true });
        } else {
            await ctx.answerCbQuery('🦊 偷菜成功！');
            await renderFarm(ctx, userId);
        }
    } else if (data === 'action_bug') {
        const success = releaseBug(userData);
        if (!success) {
            await ctx.answerCbQuery('🐛 没有生长中的作物可放虫', { show_alert: true });
        } else {
            await ctx.answerCbQuery('🐛 放虫成功！');
            await renderFarm(ctx, userId);
        }
    } else {
        await ctx.answerCbQuery('未知操作');
    }
}

// 导出函数
module.exports = {
    createFarm: getOrCreateFarm,
    renderFarm,
    handleCallback,
    plantCrop,
    harvestAll,
    stealCrop,
    releaseBug,
};
{
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install"
  },
  "deploy": {
    "startCommand": "npm start",
    "healthcheckPath": "/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
# 🌾 Telegram 农场机器人

一个类似QQ农场的Telegram机器人，支持种植、收获、偷菜、放虫等玩法。

## 🚀 快速开始

### 1. 获取 Bot Token
- 在 Telegram 中搜索 @BotFather
- 发送 `/newbot` 创建机器人
- 复制获得的 Token

### 2. 部署到 Railway (推荐)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/yourusername/telegram-farm-bot)

或手动部署：
```bash
git clone https://github.com/yourusername/telegram-farm-bot
cd telegram-farm-bot
npm install
echo "BOT_TOKEN=你的Token" > .env
npm start
