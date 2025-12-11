const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  country: {
    type: String,
    required: true,
  },
  paymentGroups: [{
    type: {
      type: String,
      required: true
    },
    paymentId: String,
    amount: Number // Add amount field for payment groups
  }],
  orderId: String,
  customerEmail: String,
  state: String,
  site: String, // Add site field
  subtotal: Number, // For price without tax
  totalTax: Number, // For UP_TAX_SHIPPING
  amountPaid: Number, // For amtPaid
  totalAmount: Number, // Order total
  updatedAt: Date,
  createdAt: Date
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);