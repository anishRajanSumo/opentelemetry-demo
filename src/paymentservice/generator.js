const { trace, SpanKind, context } = require('@opentelemetry/api')
const { v4: uuidv4 } = require('uuid')

const tracer = trace.getTracer('paymentservice')

const SQS_ATTRS = {
  'messaging.url': process.env.SQS_QUEUE_URL || 'https://sqs.us-west-2.amazonaws.com/224064240808/pdet-otel-demo',
  'messaging.system': 'aws.sqs',
  'messaging.destination': process.env.SQS_QUEUE_NAME || 'pdet-otel-demo',
  'messaging.destination_kind': 'queue',
  'aws.service.identifier': 'sqs',
  'aws.service.name': 'Amazon SQS',
  'aws.service.api': 'SQS',
  'aws.signature.version': 'v4',
  'rpc.system': 'aws-api',
  'rpc.service': 'SQS',
}

const DB_HOST = process.env.DB_HOST || 'prod-pdet-otel-demo.cwqfkmh8tsk3.us-west-2.rds.amazonaws.com'
const DB_NAME = process.env.DB_NAME || 'Payments'
const DB_USER = process.env.DB_USER || 'samyak'

const MYSQL_ATTRS = {
  'db.system': 'mysql',
  'db.name': DB_NAME,
  'db.user': DB_USER,
  'db.connection_string': `jdbc:mysql://${DB_HOST}:3306/${DB_NAME}`,
  'net.peer.name': DB_HOST,
  'net.peer.port': 3306,
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min) + min)
}

function randomIP() {
  const octets = [44, randomInt(234, 242), randomInt(123, 184), randomInt(130, 215)]
  return octets.join('.')
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function generateTransaction(config) {
  const ip = randomIP()

  const rootSpan = tracer.startSpan('pdet-otel-demo receive', {
    kind: SpanKind.CONSUMER,
    attributes: {
      ...SQS_ATTRS,
      'messaging.operation': 'receive',
      'aws.operation': 'receiveMessage',
      'aws.region': 'us-west-2',
      'aws.request.id': uuidv4(),
      'rpc.method': 'ReceiveMessage',
    },
  })

  const rootCtx = trace.setSpan(context.active(), rootSpan)

  await context.with(rootCtx, async () => {
    const postSpan = tracer.startSpan('POST', {
      kind: SpanKind.CLIENT,
      attributes: {
        'net.peer.name': 'sqs.us-west-2.amazonaws.com',
        'net.peer.port': '443',
        'net.peer.ip': ip,
      },
    })

    const postCtx = trace.setSpan(context.active(), postSpan)

    await context.with(postCtx, async () => {
      const tlsSpan = tracer.startSpan('tls.connect', { kind: SpanKind.INTERNAL })
      const tlsCtx = trace.setSpan(context.active(), tlsSpan)

      await context.with(tlsCtx, async () => {
        const tcpSpan = tracer.startSpan('tcp.connect', {
          kind: SpanKind.INTERNAL,
          attributes: {
            'net.peer.name': 'sqs.us-west-2.amazonaws.com',
            'net.peer.port': '443',
            'net.peer.ip': ip,
          },
        })
        await sleep(randomInt(3, 7))
        tcpSpan.end()
      })

      await sleep(randomInt(8, 15))
      tlsSpan.end()
    })

    await sleep(randomInt(50, 200))
    postSpan.setStatus({ code: 0 })
    postSpan.end()

    const chargeResult = await generateChargeSpan(config)

    if (randomInt(1, 4) === 2) {
      await generateMySQLInsertSpan(config)
    }

    await generateSQSDeleteSpan()
  })

  rootSpan.setAttribute('http.status_code', 200)
  rootSpan.setStatus({ code: 0 })
  rootSpan.end()
}

async function generateChargeSpan(config) {
  const chargeSpan = tracer.startSpan('charge', {
    kind: SpanKind.INTERNAL,
    attributes: {
      'app.payment.card_type': 'visa',
      'app.payment.card_valid': 'true',
      'app.payment.charged': 'true',
    },
  })

  const chargeDuration = config.mode === 'chaos' ? randomInt(1200, 1600) : randomInt(0, 7)
  await sleep(chargeDuration)
  chargeSpan.end()
}

async function generateMySQLInsertSpan(config) {
  const customerID = uuidv4()
  const transactionID = uuidv4()
  const paymentMethods = ['cash', 'credit_card', 'debit_card']
  const paymentMethod = paymentMethods[randomInt(0, 3)]

  const now = new Date()
  const pastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
  const randomTime = new Date(pastYear.getTime() + Math.random() * (now.getTime() - pastYear.getTime()))
  const purchaseDate = `${randomTime.getFullYear()}-${randomTime.getMonth()+1}-${randomTime.getDate()} ${randomTime.getHours()}:${randomTime.getMinutes()}:${randomTime.getSeconds()}`
  const randomTime2 = new Date(pastYear.getTime() + Math.random() * (now.getTime() - pastYear.getTime()))
  const createdAt = `${randomTime2.getFullYear()}-${randomTime2.getMonth()+1}-${randomTime2.getDate()} ${randomTime2.getHours()}:${randomTime2.getMinutes()}:${randomTime2.getSeconds()}`

  const statement = `INSERT INTO transactions (customer_id, transaction_id, purchase_date, created_at, payment_method) VALUES ('${customerID}', '${transactionID}', '${purchaseDate}', '${createdAt}', '${paymentMethod}')`

  const insertSpan = tracer.startSpan('INSERT', {
    kind: SpanKind.CLIENT,
    attributes: {
      ...MYSQL_ATTRS,
      'db.statement': statement,
    },
  })

  const insertDuration = config.mode === 'chaos' ? randomInt(2700, 4000) : randomInt(5, 8)
  await sleep(insertDuration)

  console.log(`Query execution time: ${insertDuration} milliseconds`)
  if (insertDuration > 2700 && insertDuration < 3600) {
    console.log("WARNING: Inserting user details taking a lot of time")
  } else if (insertDuration > 3600) {
    console.log("ERROR: Error in Inserting user details for user id:", uuidv4())
  }

  insertSpan.end()
  return insertDuration
}

async function generateSQSDeleteSpan() {
  const deleteSpan = tracer.startSpan('SQS.DeleteMessage', {
    kind: SpanKind.CLIENT,
    attributes: {
      ...SQS_ATTRS,
      'aws.operation': 'deleteMessage',
      'aws.region': 'us-west-2',
      'aws.request.id': uuidv4(),
      'rpc.method': 'DeleteMessage',
    },
  })

  await sleep(randomInt(28, 33))
  deleteSpan.setStatus({ code: 0 })
  deleteSpan.end()
}

module.exports = { generateTransaction, sleep, randomInt }
