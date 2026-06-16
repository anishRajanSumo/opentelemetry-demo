const { generateTransaction, sleep, randomInt } = require('./generator')
const logger = require('./logger')

const CONFIG = {
  mode: process.env.GENERATOR_MODE || 'normal',
  ratePerMinute: parseInt(process.env.RATE_PER_MINUTE || '3'),
}

async function main() {
  logger.info(`PaymentService trace generator starting in ${CONFIG.mode} mode, rate: ${CONFIG.ratePerMinute}/min`)

  while (true) {
    try {
      logger.info("Charge request received from SQS.")
      await generateTransaction(CONFIG)
      logger.info("Charge processed successfully.")
    } catch (err) {
      logger.error({ err }, "Error generating transaction trace.")
    }

    const intervalMs = Math.floor(60000 / CONFIG.ratePerMinute) + randomInt(-500, 500)
    await sleep(intervalMs)
  }
}

main()
