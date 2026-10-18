/** The response the API explorer opens with: a paginated orders list from a made-up wholesale shop. */
export const SAMPLE_URL = 'https://api.example-wholesale.in/v1/orders'
export const SAMPLE_ROOT = 'OrdersResponse'

export const SAMPLE_JSON = JSON.stringify(
  {
    page: 1,
    perPage: 20,
    total: 128,
    orders: [
      {
        id: 'b3f1c2d4-7a8e-4f21-9c3d-2e5a6b7c8d90',
        number: 'WH-10421',
        status: 'shipped',
        placedAt: '2026-10-12T09:41:00+05:30',
        buyer: {
          id: 2201,
          company: 'Shah Traders',
          contactName: 'Diya Shah',
          email: 'diya@shahtraders.in',
          gstin: '24ABCDE1234F1Z5',
        },
        shippingAddress: { line1: '14 Station Road', city: 'Rajkot', state: 'Gujarat', pincode: '360001' },
        items: [
          { sku: 'LMP-1001', name: 'Brass table lamp', quantity: 24, unitPrice: 899.5, imageUrl: 'https://cdn.example.in/p/lmp-1001.jpg' },
          { sku: 'CUP-2040', name: 'Ceramic mug set', quantity: 60, unitPrice: 349, imageUrl: null },
        ],
        totals: { subtotal: 42528, tax: 7655.04, grandTotal: 50183.04, currency: 'INR' },
        notes: null,
        isPaid: true,
      },
      {
        id: '0c9a8b7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d',
        number: 'WH-10422',
        status: 'pending',
        placedAt: '2026-10-13T16:05:00+05:30',
        buyer: {
          id: 2207,
          company: 'Mehta Home Store',
          contactName: 'Rohan Mehta',
          email: 'rohan@mehtahome.in',
          phone: '+91 98250 11223',
        },
        shippingAddress: { line1: '7 Ring Road', line2: 'Near City Mall', city: 'Ahmedabad', state: 'Gujarat', pincode: '380015' },
        items: [{ sku: 'RUG-3300', name: 'Handloom rug', quantity: 10, unitPrice: 2450, imageUrl: 'https://cdn.example.in/p/rug-3300.jpg' }],
        totals: { subtotal: 24500, tax: 4410, grandTotal: 28910, currency: 'INR' },
        notes: 'Deliver after 11 am',
        isPaid: false,
      },
    ],
  },
  null,
  2,
)
