import {pgTable , text , timestamp , uuid} from 'drizzle-orm/pg-core'

export const tenants = pgTable('tenants' , {
  id : uuid('id').primaryKey().defaultRandom(),
  name : text('name').notNull(),
  plan : text('plan').notNull().default('free'), // 'free', 'pro', 'enterprise'
  created_at : timestamp('created_at').notNull().defaultNow(),
  updated_at : timestamp('updated_at').notNull().defaultNow(),

})