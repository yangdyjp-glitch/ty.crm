type ChannelNamedRow = {
  name?: string | null
  type?: string | null
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

function channelSourceRank(type: unknown) {
  const text = String(type ?? '')
  if (text.includes('第三方')) return 0
  if (text.includes('自获取')) return 1
  return 2
}

export function sortChannelLeadStats<T extends ChannelNamedRow>(rows?: T[] | null) {
  return [...(rows || [])].sort((a, b) => {
    const aName = String(a.name ?? '')
    const bName = String(b.name ?? '')
    const sourceDiff = channelSourceRank(a.type) - channelSourceRank(b.type)
    if (sourceDiff !== 0) return sourceDiff
    const rankDiff = channelKeywordRank(aName) - channelKeywordRank(bName)
    if (rankDiff !== 0) return rankDiff
    return aName.localeCompare(bName, 'zh-CN')
  })
}
