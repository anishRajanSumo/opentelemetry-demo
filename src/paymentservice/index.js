const { generateTransaction, sleep, randomInt, generateFakeBody } = require('./generator')
const logger = require('./logger')

const DB_HOST = process.env.DB_HOST || 'prod-pdet-otel-demo.cwqfkmh8tsk3.us-west-2.rds.amazonaws.com'
const DB_NAME = process.env.DB_NAME || 'Payments'

const CONFIG = {
  mode: process.env.GENERATOR_MODE || 'chaos',
  ratePerMinute: parseInt(process.env.RATE_PER_MINUTE || '3'),
}

async function main() {
  console.log(`Attempting to connect to DB: HOST - '${DB_HOST}' , Database - '${DB_NAME}'`)

  logger.info(`PaymentService trace generator starting in ${CONFIG.mode} mode, rate: ${CONFIG.ratePerMinute}/min`)

  while (true) {
    try {
      const body = generateFakeBody()
      logger.info({ body }, "Charge request received from SQS.")
      const response = await generateTransaction(CONFIG)
      logger.info({ response }, "Charge processed successfully.")
    } catch (err) {
      logger.error({ err }, "Error processing charge.")
    }

    const intervalMs = Math.floor(60000 / CONFIG.ratePerMinute) + randomInt(-500, 500)
    await sleep(intervalMs)
  }
}

main()
