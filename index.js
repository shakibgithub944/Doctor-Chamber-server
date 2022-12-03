const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId, ObjectID } = require('mongodb');
const jwt = require('jsonwebtoken');
require('dotenv').config()
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000
const app = express();

app.use(cors())
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.ofvswtt.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJwt(req, res, next) {
    const authHeader = req.headers.authorization;
    // console.log(authHeader);
    if (!authHeader) {
        return res.status(401).send('Unathorize access')
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send('Request forbidden')
        }
        req.decoded = decoded;
        next()
    })
}

async function run() {
    try {
        const appointmentCollections = client.db('DoctorChamber').collection('appointments');
        const bookingCollections = client.db('DoctorChamber').collection('bookings');
        const usersCollections = client.db('DoctorChamber').collection('users');
        const doctorsCollections = client.db('DoctorChamber').collection('doctors');
        const paymentsCollections = client.db('DoctorChamber').collection('payments');

        // verify admin 

        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = {
                email: decodedEmail,
            }
            const user = await usersCollections.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'Request Forbidden' })
            }
            next()
        }

        app.get('/appointments', async (req, res) => {
            const date = req.query.date;
            const query = {};
            const appointments = await appointmentCollections.find(query).toArray();
            const bookingQuery = { Date: date };
            const alreadyBook = await bookingCollections.find(bookingQuery).toArray();
            appointments.forEach(appointment => {
                const bookedAppointment = alreadyBook.filter(booked => booked.treatment === appointment.name);
                const bookedSlots = bookedAppointment.map(book => book.time);
                const remainingSlots = appointment.slots.filter(slot => !bookedSlots.includes(slot))
                appointment.slots = remainingSlots;
            })
            res.send(appointments);
        })

        app.get('/appointmetnSpeciality', async (req, res) => {
            const query = {}
            const result = await appointmentCollections.find(query).project({ name: 1 }).toArray()
            res.send(result);
        })

        app.get('/bookings', verifyJwt, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email
            if (email !== decodedEmail) {
                return res.status(401).send('Unathorize access')
            }
            const query = {
                email: email,
            }
            const bookings = await bookingCollections.find(query).toArray();
            res.send(bookings.reverse());

        })

        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const result = await bookingCollections.findOne(filter);
            res.send(result)
        })

        app.post('/bookings', async (req, res) => {
            const appointment = req.body;
            const query = {
                Date: appointment.Date,
                email: appointment.email,
                treatment: appointment.treatment,
            }
            const alreadyBook = await bookingCollections.find(query).toArray();
            if (alreadyBook.length) {
                const message = `You already booked on ${appointment.Date}`
                return res.send({ acknowledged: false, message })
            }

            const result = await bookingCollections.insertOne(appointment)
            res.send(result)
        })

        app.get('/allUsers', verifyJwt, verifyAdmin, async (req, res) => {
            const query = {}
            const result = await usersCollections.find(query).toArray();
            res.send(result);
        })

        app.get('/allUsers/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollections.findOne(query);
            // console.log(user?.role);
            res.send({ isAdmin: user?.role === 'admin' })

        })

        app.put('/allUsers/admin/:id', verifyJwt, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const options = { upsert: true }
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollections.updateOne(filter, updatedDoc, options);
            res.send(result);

        })
        // temporary api for adding price in booking items..
        // app.get('/allprice', async (req, res) => {
        //     const filter = {}
        //     const options = { upsert: true }
        //     const updatedDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result = await appointmentCollections.updateMany(filter, updatedDoc, options);
        //     res.send(result)
        // })


        app.post('/user', async (req, res) => {
            const user = req.body;
            const result = await usersCollections.insertOne(user);
            res.send(result);

        })
        // payment intent
        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body
            const price = booking.price
            const amount = price * 100
            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ],
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })
        app.post('/payment', async (req, res) => {
            const booking = req.body
            const result = await paymentsCollections.insertOne(booking);
            const id = booking.bookingId
            const filter = { _id: ObjectId(id) }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transectinId: booking.transectinId
                }
            }
            const updatedResult = await bookingCollections.updateOne(filter, updatedDoc)
            res.send(result)
        })

        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const user = await usersCollections.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '7d' })
                return res.send({ accessToken: token });
            }
            res.status(403).send({ accesstoken: 'Request Forbidden' })
        })

        app.get('/doctors', verifyJwt, verifyAdmin, async (req, res) => {
            const filter = {}
            const result = await doctorsCollections.find(filter).toArray();
            res.send(result);
        })

        app.post('/doctors', verifyJwt, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollections.insertOne(doctor);
            res.send(result);
        })

        app.delete('/doctor/:id', verifyJwt, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const result = await doctorsCollections.deleteOne(query);
            res.send(result)
        })


    }
    finally {

    }
}
run().catch(err => console.log(err));



app.get('/', (req, res) => {
    res.send('Doctor Chamber Runninng.....')
})



app.listen(port, () => {
    console.log('DoctorChamber Server is Runnig on port', port)
})
