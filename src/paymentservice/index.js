// // Copyright The OpenTelemetry Authors
// // SPDX-License-Identifier: Apache-2.0
// const grpc = require('@grpc/grpc-js')
// const protoLoader = require('@grpc/proto-loader')
// const health = require('grpc-js-health-check')
// const opentelemetry = require('@opentelemetry/api')

// const charge = require('./charge')
// const logger = require('./logger')

// function chargeServiceHandler(call, callback) {
//   const span = opentelemetry.trace.getActiveSpan();

//   try {
//     const amount = call.request.amount
//     span.setAttributes({
//       'app.payment.amount': parseFloat(`${amount.units}.${amount.nanos}`)
//     })
//     logger.info({ request: call.request }, "Charge request received.")

//     const response = charge.charge(call.request)
//     callback(null, response)

//   } catch (err) {
//     logger.warn({ err })

//     span.recordException(err)
//     span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR })

//     callback(err)
//   }
// }

// async function closeGracefully(signal) {
//   server.forceShutdown()
//   process.kill(process.pid, signal)
// }

// const otelDemoPackage = grpc.loadPackageDefinition(protoLoader.loadSync('demo.proto'))
// const server = new grpc.Server()

// server.addService(health.service, new health.Implementation({
//   '': health.servingStatus.SERVING
// }))

// server.addService(otelDemoPackage.oteldemo.PaymentService.service, { charge: chargeServiceHandler })

// server.bindAsync(`0.0.0.0:${process.env['PAYMENT_SERVICE_PORT']}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
//   if (err) {
//     return logger.error({ err })
//   }

//   logger.info(`PaymentService gRPC server started on port ${port}`)
//   server.start()
// }
// )

// process.once('SIGINT', closeGracefully)
// process.once('SIGTERM', closeGracefully)

const AWS = require('aws-sdk');
const opentelemetry = require('@opentelemetry/api');
const charge = require('./charge');
const logger = require('./logger');

// Configure the AWS region of the SQS queue
AWS.config.update({ region: 'us-west-2' });

// Create an SQS service object
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

// SQS Queue URL
const queueUrl = process.env.QUEUE_URL;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollSQSQueue() {
  const params = {
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 10, // Adjust as needed
    WaitTimeSeconds: 20 // Use long polling
  };

  try {
    const data = await sqs.receiveMessage(params).promise();
    if (data.Messages) {
      for (const message of data.Messages) {
        // Parse the message body
        const body = JSON.parse(message.Body);
        logger.info({ body }, "Charge request received from SQS.");

        // Start a span for the charge operation
        const span = opentelemetry.trace.getTracer('paymentservice').startSpan('charge');

        try {
          // Process the payment
          const transformedBody = {
            creditCard: {
              creditCardNumber: body.credit_card.credit_card_number,
              creditCardExpirationYear: body.credit_card.credit_card_expiration_year,
              creditCardExpirationMonth: body.credit_card.credit_card_expiration_month,
              // ... include other necessary properties ...
            },
            amount: body.amount,
            // ... include other necessary properties ...
          };

          // Process the payment with the correctly structured object
          const response = charge.charge(transformedBody);
          logger.info({ response }, "Charge processed successfully.");
          const delay_time = getRandomInt(1,1500)
          await delay(delay_time)
          // Delete the message from the queue if the charge was successful
          await sqs.deleteMessage({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }).promise();

          span.end(); // End the span successfully
        } catch (err) {
          logger.error({ err }, "Error processing charge.");

          span.recordException(err);
          span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
          span.end(); // End the span with an error
        }
      }
    }
  } catch (error) {
    logger.error('No more messages in SQS ', error);
  }

  // Continue polling for new messages
  setImmediate(pollSQSQueue);
}
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); // The maximum is exclusive and the minimum is inclusive
}
// Start polling the SQS queue
pollSQSQueue();

