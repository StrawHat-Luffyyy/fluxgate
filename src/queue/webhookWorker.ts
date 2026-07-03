import {Worker , type Job} from 'bullmq'
import {connection} from './connection.js'
import type {WebhookPayload} from './webhookQueue.js'


const MOCK_TENANT_WEBHOOK_URL = 'https://webhook.site/fluxgate-test';

export const  startWebhookWorker = () => {
  console.log('BullMQ Webhook Worker started....');

  const worker = new Worker<WebhookPayload>('webhooks', async (job: Job<WebhookPayload>) => {
    console.log(`Processing Webhook Job ${job.id} for Tenant ${job.data.tenantId}...`)
    const payload = {
      id : job.id,
      timestamp : new Date().toISOString(),
      ...job.data
    } 
    const response = await fetch(MOCK_TENANT_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    
    })
    if(!response.ok){
      throw new Error(`Webhook failed with status: ${response.status}`);
    }
    console.log(`Webhook delivered successfully for Job ${job.id}`);
  })
  return worker;
}