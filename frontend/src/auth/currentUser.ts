export type Role = 'staff' | 'admin'

export interface CurrentUser {
  name: string
  role: Role
  storeCode: string
}
