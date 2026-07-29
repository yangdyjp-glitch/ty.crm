type ChannelNamedRow = {
  name?: string | null
}

const CHANNEL_NAME_KEYWORDS = ['途洋', '行知', '一嘉一']

function channelKeywordRank(name: unknown) {
  const text = String(name ?? '')
  const index = CHANNEL_NAME_KEYWORDS.findIndex((keyword) => text.includes(keyword))
  return index === -1 ? CHANNEL_NAME_KEYWORDS.length : index
}

export function sortByChannelNameKeyword<T extends ChannelNamedRow>(rows?: T[] | null) {
  return [...(rows || [])].sort((a, b) => {
    const aName = String(a.name ?? '')
    const bName = String(b.name ?? '')
    const rankDiff = channelKeywordRank(aName) - channelKeywordRank(bName)
    if (rankDiff !== 0) return rankDiff
    return aName.localeCompare(bName, 'zh-CN')
  })
}
