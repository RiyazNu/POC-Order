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
    paymentId: String
  }],
  orderId: String,
  customerEmail: String,
  state: String,
  updatedAt: Date,
  createdAt: Date
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);