import type { KitchenData, ReceiptData } from "./layout";

/** Made-up slips for the previews on the Printing pages. Not real orders. */

export const SAMPLE_RECEIPT: ReceiptData = {
  business: "Your Cafe",
  pan: "123456789",
  branch: "Main branch",
  address: "Lakeside, Pokhara",
  invoiceNumber: 1042,
  orderNumber: 217,
  bsDate: "2083-08-01",
  when: "16 Nov 2026, 12:29",
  where: "Table 4",
  customer: "Sita Rai",
  lines: [
    { name: "Buff Momo", quantity: 2, total: 50_000, complimentary: false, note: "extra spicy", addOns: ["Cheese"] },
    { name: "Masala Tea", quantity: 2, total: 16_000, complimentary: false, note: null, addOns: [] },
    { name: "Water", quantity: 1, total: 0, complimentary: true, note: null, addOns: [] },
  ],
  subtotal: 66_000,
  discount: 6_600,
  loyaltyDiscount: 0,
  serviceCharge: 5_940,
  vat: 7_722,
  deliveryFee: 0,
  roundOff: 38,
  grandTotal: 73_100,
  payments: [
    { method: "CASH", amount: 50_000 },
    { method: "QR", amount: 23_100 },
  ],
  creditNotes: [],
};

export const SAMPLE_KITCHEN: KitchenData = {
  branch: "Main branch",
  title: "Table 4",
  number: 217,
  time: "12:29",
  waiter: "Ram",
  note: "Allergy: no nuts",
  groups: [
    { station: "Grill", items: [{ quantity: 2, name: "Buff Momo", note: "extra spicy", addOns: ["Cheese"] }] },
    { station: "Bar", items: [{ quantity: 2, name: "Masala Tea", note: "no sugar", addOns: [] }] },
  ],
};
