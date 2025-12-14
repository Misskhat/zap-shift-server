const express = require("express");
const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRITE);
const cors = require("cors");
const {MongoClient, ServerApiVersion, ObjectId} = require("mongodb");
const crypto = require("crypto");
// import crypto from "crypto";
const port = process.env.PORT || 3000;

function generateTrackingId(prefix = "PKG") {
  const randomPart = crypto
    .randomBytes(6)
    .toString("hex")
    .toUpperCase();

  return `${prefix}-${randomPart}`;
}

//middleware
app.use(express.json());
app.use(cors());

// mongodb connection uri
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.5bt6oyo.mongodb.net/?appName=Cluster0`;

app.get("/", (req, res) => {
    res.send("zap shift server running!");
});

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db("zapShiftDB");
        const parcelsCollection = db.collection("parcels");
        const paymentsCollection = db.collection("payments");

        // parcels api
        app.get("/parcels", async (req, res) => {
            const query = {};
            const {email} = req.query;
            if (query) {
                query.senderEmail = email;
            }
            const options = {sort: {time: -1}};
            const cursor = parcelsCollection.find(query, options);
            const result = await cursor.toArray();
            res.send(result);
        });

        app.get("/parcels/:id", async (req, res) => {
            const id = req.params.id;
            const query = {_id: new ObjectId(id)};
            const result = await parcelsCollection.findOne(query);
            res.send(result);
        });

        app.post("/parcels", async (req, res) => {
            const parcel = req.body;
            // set time
            parcel.time = new Date();
            const result = await parcelsCollection.insertOne(parcel);
            res.send(result);
        });

        app.delete("/parcels/:id", async (req, res) => {
            const id = req.params.id;
            const query = {_id: new ObjectId(id)};
            const result = await parcelsCollection.deleteOne(query);
            res.send(result);
        });

        app.patch('/payment-success', async(req, res)=>{
            const sessionId = req.query.session_id;
            // console.log(sessionId);
            const session = await stripe.checkout.sessions.retrieve(sessionId);
            const trackingId = generateTrackingId()
            if(session.payment_status){
                const id = session.metadata.parcelId;
                const query = {_id: new ObjectId(id)};
                const update = {
                    $set:{
                        paymentStatus: 'paid',
                        trackingId: trackingId,
                    }
                }

                const payment = {
                    currency: session.currency,
                    customerEmail: session.customer_email,
                    parcelId: session.metadata.parcelId,
                    parcelName: session.metadata.parcelName,
                    transationId: session.payment_intent,
                    paymentStatus: session.payment_status,
                    paidAt: new Date()
                    
                }

                const result = await parcelsCollection.updateOne(query, update)
                if(session.payment_status === 'paid'){
                    const resultPayment = await paymentsCollection.insertOne(payment)
                    res.send({paymentStatus: true, trackingId:trackingId, transationId:session.payment_intent, modifyParcel: result, paymentInfo: resultPayment})
                }
                
            }
            res.send({session: false})
        })

        app.post("/create-checkout-session", async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo?.cost) * 100;
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: "USD",
                            unit_amount: amount,
                            product_data: {
                                name: paymentInfo.parcelName,
                            },
                        },
                        quantity: 1,
                    },
                ],
                mode: "payment",
                metadata: {
                    parcelId: paymentInfo.parcelId,
                    parcelName: paymentInfo.parcelName,
                },
                customer_email: paymentInfo.senderEmail,
                success_url: `${process.env.SITE_DOMIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMIN}/dashboard/payment-cancelled`,
            });
            console.log(session);
            res.send({url: session.url});
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ping: 1});
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
