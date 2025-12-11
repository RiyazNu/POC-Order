const { MongoClient } = require('mongodb');

// Calculate amounts (matches Python calculate_amount function)
const calculateAmount = (maoJson, model) => {
    let totalAmount = 0;
    let amtToBePaid = 0;
    let authAmt = 0;
    let paidAmt = 0;
    let discountedAmt = 0;
    const paymentSet = new Set();

    // Process OrderChargeDetail (shipping charges)
    if (maoJson.OrderChargeDetail && maoJson.OrderChargeDetail.length > 0) {
        for (const orderChargeDetail of maoJson.OrderChargeDetail) {
            const shippingAmt = parseFloat(orderChargeDetail.ChargeTotal) || 0;
            amtToBePaid += shippingAmt;
        }
    }

    // Process OrderTaxDetail
    if (maoJson.OrderTaxDetail && maoJson.OrderTaxDetail.length > 0) {
        for (const orderTaxDetail of maoJson.OrderTaxDetail) {
            const orderTaxAmt = parseFloat(orderTaxDetail.TaxAmount) || 0;
            amtToBePaid += orderTaxAmt;
        }
    }

    // Process OrderLine items
    if (maoJson.OrderLine && maoJson.OrderLine.length > 0) {
        for (const orderLine of maoJson.OrderLine) {
            // Unit price calculation
            if (orderLine.UnitPrice != null) {
                const unitPrice = (parseFloat(orderLine.UnitPrice) || 0) * (parseInt(orderLine.Quantity) || 0);
                totalAmount += unitPrice;
                amtToBePaid += unitPrice;
            }

            // OrderLineChargeDetail
            if (orderLine.OrderLineChargeDetail && orderLine.OrderLineChargeDetail.length > 0) {
                for (const orderLineChargeDetail of orderLine.OrderLineChargeDetail) {
                    const chargeTotal = parseFloat(orderLineChargeDetail.ChargeTotal) || 0;
                    totalAmount += chargeTotal;
                    amtToBePaid += chargeTotal;
                }
            }

            // OrderLineTaxDetail
            if (orderLine.OrderLineTaxDetail && orderLine.OrderLineTaxDetail.length > 0) {
                for (const orderLineTaxDetail of orderLine.OrderLineTaxDetail) {
                    const itemTaxAmt = parseFloat(orderLineTaxDetail.TaxAmount) || 0;
                    amtToBePaid += itemTaxAmt;
                }
            }
        }
    }

    // Process Payments
    if (maoJson.Payment && maoJson.Payment.length > 0) {
        for (const paymentMethod of maoJson.Payment) {
            if (paymentMethod.PaymentMethod && paymentMethod.PaymentMethod.length > 0) {
                for (const payment of paymentMethod.PaymentMethod) {
                    if (payment.PaymentType && payment.PaymentType.PaymentTypeId) {
                        paymentSet.add(payment.PaymentType.PaymentTypeId);
                        const amount = parseFloat(payment.Amount) || 0;
                        
                        if (["Credit Card", "PayPal", "Private Label Credit Card"]
                            .includes(payment.PaymentType.PaymentTypeId)) {
                            paidAmt += amount;
                        } else {
                            discountedAmt += amount;
                        }
                    }
                }
            }
        }
    }

    authAmt = paidAmt + discountedAmt;
    const difference = parseFloat((authAmt - amtToBePaid).toFixed(2));
    
    // Only update model if there's a negative difference (matches Python logic)
    if (difference < 0) {
        model.price_without_tax = parseFloat(totalAmount.toFixed(2));
        model.UP_TAX_SHIPPING = parseFloat(amtToBePaid.toFixed(2));
        model.amtPaid = parseFloat(authAmt.toFixed(2));
        model.difference = difference;
        model.paid_CC_PAYPAL = parseFloat(paidAmt.toFixed(2));
        model.GC_REWARDCARD_amt = parseFloat(discountedAmt.toFixed(2));
        model.paymentCount = Array.from(paymentSet).join(",") || "-";
    }

    return difference;
};

// UPDATED getAuthMismatchCount function with Python logic
const getAuthMismatchCount = async (req, res) => {
    let client;
    
    try {
        // FIX: Handle req.body safely - it might be undefined if JSON middleware is not used
        const body = req.body || {};
        const query = req.query || {};
        
        const { hours = 6 } = query;
        const { start_time, end_time } = body;
        
        let startDate, endDate;

        if (start_time && end_time) {
            // Use Python-style date range from request body
            startDate = new Date(start_time);
            endDate = new Date(end_time);
            
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid date format. Use ISO format (e.g., '2024-01-01T00:00:00.000Z')"
                });
            }
        } else {
            // Use existing hours-based logic
            const hoursNum = parseInt(hours);
            endDate = new Date();
            startDate = new Date(endDate.getTime() - hoursNum * 60 * 60 * 1000);
        }

        client = new MongoClient(process.env.MONGO_URI);
        await client.connect();
        
        const database = client.db("order_eddiebauer");
        const collection = database.collection("orders");

        // Build aggregation pipeline based on Python logic
        const pipeline = [
            {
                $project: {
                    maoJson: 1,
                    orderCapturedDate: 1,
                    state: 1,
                    country: 1,
                    totalAmount: 1,
                }
            },
            {
                $match: {
                    $and: [
                        {
                            orderCapturedDate: {
                                $gte: startDate,
                                $lt: endDate,
                            }
                        },
                        { 
                            state: { 
                                $in: ["SUBMITTED_TO_MAO", "ORDER_ON_HOLD"] 
                            } 
                        },
                    ]
                }
            }
        ];

        const orderList = await collection.aggregate(pipeline).toArray();
        console.log(`Total orders in time range: ${orderList.length}`);
        console.log(`Time range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

        const modelList = [];

        for (const order of orderList) {
            // Parse maoJson (assuming it's stored as string in MongoDB)
            let maoJson;
            try {
                maoJson = typeof order.maoJson === 'string' 
                    ? JSON.parse(order.maoJson) 
                    : order.maoJson;
            } catch (error) {
                console.error(`Error parsing maoJson for order: ${error.message}`);
                continue; // Skip this order if JSON is invalid
            }

            // Create model object (matches Python auth_mismatch model)
            const model = {
                placed_On: order.orderCapturedDate,
                orderId: maoJson.OrderId || "N/A",
                site: order.country === "USA" ? "US" : "CA",
                price_without_tax: 0,
                UP_TAX_SHIPPING: 0,
                amtPaid: 0,
                difference: 0,
                paid_CC_PAYPAL: 0,
                GC_REWARDCARD_amt: 0,
                paymentCount: "-"
            };

            // Calculate amounts using Python logic
            const difference = calculateAmount(maoJson, model);

            // Only add to list if difference is negative (matches Python logic)
            if (difference < 0) {
                // Convert date to ISO string for consistent response
                model.placed_On = model.placed_On.toISOString();
                modelList.push(model);
            }
        }

        console.log(`Found ${modelList.length} orders with auth mismatch (negative difference)`);

        // Calculate totals
        const totals = {
            totalPriceWithoutTax: parseFloat(modelList.reduce((sum, order) => 
                sum + (order.price_without_tax || 0), 0).toFixed(2)),
            totalTaxShipping: parseFloat(modelList.reduce((sum, order) => 
                sum + (order.UP_TAX_SHIPPING || 0), 0).toFixed(2)),
            totalAmountPaid: parseFloat(modelList.reduce((sum, order) => 
                sum + (order.amtPaid || 0), 0).toFixed(2)),
            totalDifference: parseFloat(modelList.reduce((sum, order) => 
                sum + (order.difference || 0), 0).toFixed(2)),
            totalCCPaypal: parseFloat(modelList.reduce((sum, order) => 
                sum + (order.paid_CC_PAYPAL || 0), 0).toFixed(2)),
            totalGCRewardCard: parseFloat(modelList.reduce((sum, order) => 
                sum + (order.GC_REWARDCARD_amt || 0), 0).toFixed(2)),
            count: modelList.length
        };

        // Return response in same format as before
        res.json({
            success: true,
            hours: hours,
            authMismatchCount: modelList.length,
            data: modelList,
            totals: totals,
            lastUpdated: new Date().toISOString(),
            timeRange: {
                start: startDate.toISOString(),
                end: endDate.toISOString()
            }
        });

    } catch (error) {
        console.error('Error fetching auth mismatch count:', error);
        console.error('Error stack:', error.stack);
        
        // More detailed error response
        res.status(500).json({ 
            success: false, 
            message: "Internal Server Error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
        });
    } finally {
        if (client) {
            await client.close().catch(err => console.error('Error closing MongoDB connection:', err));
        }
    }
};

// Keep your existing getPaymentSummary function unchanged
const getPaymentSummary = async (req, res) => {
    let client;
    
    try {
        const { hours = 6 } = req.query;

        client = new MongoClient(process.env.MONGO_URI);
        await client.connect();
        
        const database = client.db("order_eddiebauer");
        const collection = database.collection("orders");

        // Get data for both USA and CA
        const results = {};
        const countries = ['USA', 'CA'];
        const allPaymentMethods = new Set();

        for (const country of countries) {
            const endTime = new Date();
            const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);

            const result = await collection.aggregate([
                {
                    $match: {
                        updatedAt: {
                            $gte: startTime,
                            $lt: endTime
                        },
                        country: country
                    }
                },
                { 
                    $unwind: '$paymentGroups' 
                },
                {
                    $group: {
                        _id: '$paymentGroups.type',
                        count: { $sum: 1 }
                    }
                }
            ]).toArray();

            results[country] = {};
            result.forEach(item => {
                results[country][item._id] = item.count;
                allPaymentMethods.add(item._id);
            });
        }

        // Calculate totals and format for table
        const paymentMethods = Array.from(allPaymentMethods);
        const tableData = paymentMethods.map(method => {
            const usCount = results.USA[method] || 0;
            const caCount = results.CA[method] || 0;
            const total = usCount + caCount;
            
            return {
                method: method,
                US: usCount,
                CA: caCount,
                TOTAL: total
            };
        });

        // Sort by method name for consistent display
        tableData.sort((a, b) => a.method.localeCompare(b.method));

        // Add grand total row
        const grandTotalUS = tableData.reduce((sum, row) => sum + row.US, 0);
        const grandTotalCA = tableData.reduce((sum, row) => sum + row.CA, 0);
        const grandTotalAll = grandTotalUS + grandTotalCA;

        tableData.push({
            method: 'TOTAL',
            US: grandTotalUS,
            CA: grandTotalCA,
            TOTAL: grandTotalAll
        });

        res.json({
            success: true,
            hours: hours,
            tableData: tableData,
            lastUpdated: new Date().toLocaleString()
        });

    } catch (error) {
        console.error('Error fetching payment summary:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    } finally {
        if (client) {
            await client.close();
        }
    }
};

module.exports = { getPaymentSummary, getAuthMismatchCount };



