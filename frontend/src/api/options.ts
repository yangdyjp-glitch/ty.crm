import client from './client'

export type MoneyValue = string | number

export interface ProductOption {
  id: number
  name: string
  standardPrice: MoneyValue | null
  currency: string
}

export interface ChannelOption {
  id: number
  channelNo: string
  name: string
  channelType: string
  defaultCommissionRate: MoneyValue | null
  defaultCommissionAmount: MoneyValue | null
  commissionMethod: string
  fundSettlementMode: string
  settlementCondition: string
}

export interface AcquisitionChannelOption {
  id: number
  name: string
  active: boolean
}

export function defaultAcquisitionChannelId(channels: { id: number; name: string }[]): number | undefined {
  return channels.find((channel) => channel.name === '个人渠道')?.id
}

export interface UserOption {
  id: number
  name: string
  username: string
  role: string
}

export async function loadProducts(): Promise<ProductOption[]> {
  const { data } = await client.get<ProductOption[]>('/products')
  return data
}
export async function loadChannelOptions(): Promise<ChannelOption[]> {
  const { data } = await client.get<ChannelOption[]>('/channels/options')
  return data
}
export async function loadAcqChannels(): Promise<AcquisitionChannelOption[]> {
  const { data } = await client.get<AcquisitionChannelOption[]>('/acquisition-channels')
  return data
}
export async function loadUserOptions(role?: string): Promise<UserOption[]> {
  const { data } = await client.get<UserOption[]>('/users/options', { params: { role } })
  return data
}
