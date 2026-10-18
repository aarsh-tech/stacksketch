/** The DB to code module opens with Schemasketch's sample: a small online bookshop. */
export const SAMPLE_DB_NAME = 'Bookshop'

export const SAMPLE_DBML = `// A small online bookshop, from Schemasketch's sample.
Project bookshop {
  database_type: 'PostgreSQL'
}

Enum order_status {
  pending
  paid
  shipped
  cancelled
}

Table customers {
  id integer [pk, increment]
  email varchar(255) [unique, not null]
  full_name varchar(120) [not null]
  created_at timestamp [default: \`now()\`]
  Note: 'One row per registered buyer'
}

Table addresses {
  id integer [pk, increment]
  customer_id integer [not null, ref: > customers.id]
  line_1 varchar(200) [not null]
  city varchar(80)
  postcode varchar(12)
}

Table orders {
  id integer [pk, increment]
  customer_id integer [not null, ref: > customers.id]
  shipping_address_id integer [ref: > addresses.id]
  status order_status [not null, default: 'pending']
  placed_at timestamp [default: \`now()\`]
}

Table order_items {
  order_id integer [ref: > orders.id]
  book_id integer [ref: > books.id]
  quantity integer [not null, default: 1]
  unit_price decimal(10,2) [not null]

  indexes {
    (order_id, book_id) [pk]
  }
}

Table books {
  id integer [pk, increment]
  isbn varchar(13) [unique]
  title varchar(255) [not null]
  price decimal(10,2) [not null]
}
`
