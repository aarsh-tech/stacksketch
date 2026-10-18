import { addSchemaEndpoint, emptyContract, inferSchema, newEndpoint } from '@stacksketch/core'
import type { Contract, Shape } from '@stacksketch/core'
import { SAMPLE_JSON, SAMPLE_ROOT, SAMPLE_URL } from './sample'

const ref = (name: string): Shape => ({ kind: 'ref', name })
const STATUSES = ['pending', 'shipped', 'delivered', 'cancelled']

/**
 * The contract the designer opens with: the API explorer's sample response as
 * "List orders", plus the endpoints around it (get, place, change status,
 * cancel) and an error shape they share.
 */
export function sampleContract(): Contract {
  const base: Contract = { ...emptyContract(), title: 'Wholesale orders', description: 'Orders placed by shops on the wholesale site.' }
  const { contract } = addSchemaEndpoint(base, inferSchema([JSON.parse(SAMPLE_JSON)], SAMPLE_ROOT), { id: 'ep-list', method: 'GET', url: SAMPLE_URL })
  const order = contract.types.some((t) => t.name === 'Order') ? ref('Order') : ({ kind: 'unknown' } as Shape)
  const problem = ref('Problem')
  const [list] = contract.endpoints
  return {
    ...contract,
    types: [
      ...contract.types,
      {
        name: 'NewOrder',
        fields: [
          { key: 'buyerId', shape: { kind: 'number', integer: true }, optional: false },
          { key: 'items', shape: { kind: 'array', items: ref('NewOrderItem') }, optional: false },
          { key: 'notes', shape: { kind: 'string' }, optional: true },
        ],
      },
      {
        name: 'NewOrderItem',
        fields: [
          { key: 'sku', shape: { kind: 'string' }, optional: false },
          { key: 'quantity', shape: { kind: 'number', integer: true, min: 1 }, optional: false },
        ],
      },
      { name: 'StatusChange', fields: [{ key: 'status', shape: { kind: 'enum', values: STATUSES }, optional: false }] },
      {
        name: 'Problem',
        fields: [
          { key: 'code', shape: { kind: 'string' }, optional: false },
          { key: 'message', shape: { kind: 'string' }, optional: false },
          { key: 'details', shape: { kind: 'array', items: { kind: 'string' } }, optional: true },
        ],
      },
    ],
    endpoints: [
      {
        ...list,
        summary: 'List orders',
        params: [
          { name: 'status', in: 'query', shape: { kind: 'enum', values: STATUSES }, required: false, description: 'Only orders in this status' },
          { name: 'page', in: 'query', shape: { kind: 'number', integer: true, min: 1 }, required: false },
        ],
        responses: [...list.responses, { status: 'default', description: 'Something went wrong', body: problem }],
      },
      {
        ...newEndpoint('ep-create', 'POST', '/orders'),
        summary: 'Place an order',
        description: 'Checks stock for every item first.',
        body: { shape: ref('NewOrder'), required: true },
        responses: [
          { status: 201, description: 'The new order', body: order },
          { status: 422, description: 'An item is out of stock or the buyer is unknown', body: problem },
        ],
      },
      {
        ...newEndpoint('ep-get', 'GET', '/orders/{orderId}'),
        summary: 'Get an order',
        params: [{ name: 'orderId', in: 'path', shape: { kind: 'string', format: 'uuid' }, required: true }],
        responses: [
          { status: 200, description: 'The order', body: order },
          { status: 404, description: 'No order with that ID', body: problem },
        ],
      },
      {
        ...newEndpoint('ep-status', 'PATCH', '/orders/{orderId}/status'),
        summary: 'Change an order’s status',
        resource: 'Orders',
        params: [{ name: 'orderId', in: 'path', shape: { kind: 'string', format: 'uuid' }, required: true }],
        body: { shape: ref('StatusChange'), required: true },
        responses: [
          { status: 200, description: 'The changed order', body: order },
          { status: 409, description: 'The order can’t move to that status', body: problem },
        ],
      },
      {
        ...newEndpoint('ep-cancel', 'DELETE', '/orders/{orderId}'),
        summary: 'Cancel an order',
        params: [{ name: 'orderId', in: 'path', shape: { kind: 'string', format: 'uuid' }, required: true }],
        responses: [
          { status: 204, description: 'Cancelled' },
          { status: 409, description: 'It has already shipped', body: problem },
        ],
      },
    ],
  }
}
