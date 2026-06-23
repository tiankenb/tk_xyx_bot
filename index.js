const { Telegraf } = require('telegraf')
// 替换成你的机器人token
const bot = new Telegraf

// 触发 /start 指令回复
bot.start(ctx => {
  ctx.reply('你好，我是TK_xyx_bot机器人！')
})

// 收到任意文字自动复读
bot.on('text', ctx => {
  ctx.reply(`你发送了：${ctx.message.text}`)
})

// 启动机器人
bot.launch()
console.log('机器人启动成功')

// 关闭程序时停止服务
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
