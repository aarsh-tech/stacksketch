import type { Form, FormField } from '@stacksketch/core'

const field = (id: string, widget: FormField['widget'], key: string, label: string, extra: Partial<FormField> = {}): FormField => ({
  kind: 'field',
  id,
  widget,
  key,
  label,
  required: true,
  rules: {},
  messages: {},
  ...extra,
})

/** The form the builder opens with: a wholesale buyer signing up, with the GST number shown only for companies. */
export const sampleForm = (): Form => ({
  version: 1,
  id: 'f1',
  name: 'BuyerSignupForm',
  title: 'Open a wholesale account',
  description: 'Buy at trade prices. We check every account within a day.',
  submitLabel: 'Create my account',
  items: [
    { kind: 'step', id: 'st1', title: 'About you' },
    field('a1', 'text', 'fullName', 'Full name', { placeholder: 'Diya Shah', rules: { min: 2, max: 80 } }),
    field('a2', 'text', 'email', 'Work email', { inputType: 'email', placeholder: 'diya@shahtraders.in' }),
    field('a3', 'text', 'phone', 'Mobile number', { inputType: 'tel', required: false, placeholder: '+91 98250 11223', help: 'For delivery updates only.' }),
    { kind: 'step', id: 'st2', title: 'Your business' },
    field('b1', 'radio', 'businessType', 'Business type', {
      options: [
        { value: 'individual', label: 'Individual or proprietor' },
        { value: 'company', label: 'Registered company' },
      ],
    }),
    field('b2', 'text', 'companyName', 'Company name', { showWhen: { field: 'businessType', op: 'equals', value: 'company' } }),
    field('b3', 'text', 'gstNumber', 'GST number', {
      placeholder: '24ABCDE1234F1Z5',
      rules: { pattern: '^\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' },
      messages: { pattern: 'A GSTIN has 15 characters, like 24ABCDE1234F1Z5' },
      showWhen: { field: 'businessType', op: 'equals', value: 'company' },
    }),
    field('b4', 'select', 'monthlySpend', 'Expected monthly order', {
      options: [
        { value: 'under-50k', label: 'Under ₹50,000' },
        { value: '50k-2l', label: '₹50,000 to ₹2 lakh' },
        { value: 'over-2l', label: 'Over ₹2 lakh' },
      ],
    }),
    { kind: 'section', id: 'se1', title: 'Delivery address', description: 'Where your orders will be shipped.' },
    field('c1', 'text', 'address.line1', 'Address'),
    field('c2', 'text', 'address.city', 'City'),
    field('c3', 'text', 'address.pincode', 'Pincode', { rules: { pattern: '^\\d{6}$' }, messages: { pattern: 'Pincodes have six digits' } }),
    field('c4', 'textarea', 'notes', 'Delivery notes', { required: false, rules: { max: 300 }, placeholder: 'Loading bay at the back, open 10 am to 6 pm' }),
    field('c5', 'checkbox', 'terms', 'I agree to the trade terms'),
  ],
})
