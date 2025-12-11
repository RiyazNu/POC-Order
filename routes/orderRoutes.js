const express = require('express');
const { getPaymentSummary, getAuthMismatchCount } = require('../controllers/authController');

const router = express.Router();

router.get('/payment-summary', getPaymentSummary);
router.get('/auth-mismatch', getAuthMismatchCount); // New route


module.exports = router;