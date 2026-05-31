import client from './client'

export async function loadProducts() {
  const { data } = await client.get('/products')
  return data as any[]
}
export async function loadChannelOptions() {
  const { data } = await client.get('/channels/options')
  return data as any[]
}
export async function loadAcqChannels() {
  const { data } = await client.get('/acquisition-channels')
  return data as any[]
}
export async function loadUserOptions(role?: string) {
  const { data } = await client.get('/users/options', { params: { role } })
  return data as any[]
}
