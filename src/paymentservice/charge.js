// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0
const {context, propagation, trace, metrics} = require('@opentelemetry/api');
const cardValidator = require('simple-card-validator');
const { v4: uuidv4 } = require('uuid');
// import CreditCardGenerator, { CreditCardVendor } from 'credit-card-generator';

const logger = require('./logger');
const tracer = trace.getTracer('paymentservice');
const meter = metrics.getMeter('paymentservice');
const transactionsCounter = meter.createCounter('app.payment.transactions')

const mysql = require('mysql2');
const { log } = require('@grpc/grpc-js/build/src/logging');

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_TABLE,
};

console.log(`Attempting to connect to DB: HOST - '${dbConfig.host}' , Database - '${dbConfig.database}'`);
const pool = mysql.createPool(dbConfig);
const promisePool = pool.promise();

const paymentMethods = ['cash', 'credit_card', 'debit_card'];

const util = require('util');
const sleep = util.promisify(setTimeout);

module.exports.charge = request => {
  const span = tracer.startSpan('charge');

  const {
    creditCardNumber: number,
    creditCardExpirationYear: year,
    creditCardExpirationMonth: month
  } = request.creditCard;
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const lastFourDigits = number.substr(-4);
  const transactionId = uuidv4();

  const card = cardValidator(number);
  const { card_type: cardType, valid } = card.getCardDetails();

  span.setAttributes({
    'app.payment.card_type': cardType,
    'app.payment.card_valid': valid
  });

  if (!valid) {
    throw new Error('Credit card info is invalid.');
  }

  if (!['visa', 'mastercard'].includes(cardType)) {
    throw new Error(`Sorry, we cannot process ${cardType} credit cards. Only VISA or MasterCard is accepted.`);
  }

  if ((currentYear * 12 + currentMonth) > (year * 12 + month)) {
    throw new Error(`The credit card (ending ${lastFourDigits}) expired on ${month}/${year}.`);
  }

  // check baggage for synthetic_request=true, and add charged attribute accordingly
  const baggage = propagation.getBaggage(context.active());
  if (baggage && baggage.getEntry("synthetic_request") && baggage.getEntry("synthetic_request").value === "true") {
    span.setAttribute('app.payment.charged', false);
  } else {
    span.setAttribute('app.payment.charged', true);
  }

  span.end();

  const { units, nanos, currencyCode } = request.amount;
  logger.info({transactionId, cardType, lastFourDigits, amount: { units, nanos, currencyCode }}, "Transaction complete.");
  transactionsCounter.add(1, {"app.payment.currency": currencyCode})

  // Insert credit card details into the database
  insertCreditCardDetails(transactionId, request.creditCard);
  return {transactionId}
}
function randomPaymentMethod() {
  return paymentMethods[Math.floor(Math.random() * paymentMethods.length)];
}

function randomDate() {
  const now = new Date();
  const pastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const randomTime = new Date(pastYear.getTime() + Math.random() * (now.getTime() - pastYear.getTime()));

  const year = randomTime.getFullYear();
  const month = randomTime.getMonth() + 1; // Months are 0-based
  const day = randomTime.getDate();
  const hours = randomTime.getHours();
  const minutes = randomTime.getMinutes();
  const seconds = randomTime.getSeconds();

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function dropIndexIfExists() {
  const indexName = 'idx_customer_id';
  const tableName = 'transactions';

  try {
    console.log(`Attempting to drop index '${indexName}' from table '${tableName}'`);
    await promisePool.execute(
        `DROP INDEX ${indexName} ON ${tableName}`
    );
    console.log(`Index '${indexName}' dropped successfully`);
  } catch (error) {
    console.log(`Index '${indexName}' does not exist or cannot be dropped`);
  }
}

async function CreateIndexIfNotExists() {
  const indexName = 'idx_customer_id';
  const tableName = 'transactions';
  const columnName = 'customer_id';

  try {
    console.log(`Attempting to create index '${indexName}' on table '${tableName}'`);
    await promisePool.execute(
        `CREATE INDEX ${indexName} ON ${tableName}(${columnName})`
    );
    console.log(`Index '${indexName}' created successfully`);
  } catch (error) {
    console.log(`Index '${indexName}' already exists`);
  }
}

async function insertCreditCardDetails(transactionId, cardDetails) {
  const {
    creditCardNumber: number,
    creditCardExpirationYear: year,
    creditCardExpirationMonth: month
  } = cardDetails;

  const card = cardValidator(number);
  const { card_type: cardType, valid } = card.getCardDetails();
  try {
    if(process.env.INDEX_MADE == "no")
    {
      await dropIndexIfExists();
      process.env.INDEX_MADE = "yes"
    }
    const startTime = performance.now();
    // await promisePool.execute(`
    // SELECT customer_id, COUNT(*) as transaction_count FROM transactions GROUP BY customer_id HAVING COUNT(*) > 1
    // `);
    const endTime = performance.now();
    // Assuming you want to print the number of customers with more than one transaction
    const randomNumber= getRandomInt(1,3);
    if(randomNumber == 2)
    {
      const insertQuery = `INSERT INTO transactions (customer_id, transaction_id, purchase_date, created_at, payment_method) VALUES (?, ?, ?, ?, ?)`;
      // Generate random transactions
      const customerID = uuidv4();
      const transactionID = uuidv4();
      const purchaseDate = randomDate();
      const createdAt = randomDate();
      const paymentMethod = randomPaymentMethod();

      await promisePool.execute(insertQuery, [customerID, transactionID, purchaseDate, createdAt, paymentMethod]);
    }
    // Use Promise.race to wait for either the insert or timeout
    console.log(`Query execution time: ${endTime - startTime} milliseconds`);
    if(endTime - startTime>2700 && endTime - startTime <3600)
    {
      console.log("WARNING: Inserting user details taking a lot of time")
    }
    else if(endTime - startTime>3600){
      console.log("ERROR: Error in Inserting user details for user id:",uuidv4())
    }
    return endTime - startTime;
  } catch (error) {
    console.error('Error inserting credit card details:', error);
  }
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); // The maximum is exclusive and the minimum is inclusive
}
