export function displayBotName(bot: { id: number; remark: string; nickname: string | null; selfId: number | null }): string {
  return bot.remark || bot.nickname || (bot.selfId ? String(bot.selfId) : `Bot #${bot.id}`)
}
