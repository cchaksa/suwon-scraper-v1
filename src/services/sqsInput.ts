import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

export interface PolledSqsMessage {
  body: string;
  messageId?: string;
  receiptHandle: string;
}

export interface SqsInputClient {
  receiveOne(params: { queueUrl: string; waitTimeSeconds: number; visibilityTimeoutSeconds: number }): Promise<PolledSqsMessage | null>;
  deleteMessage(params: { queueUrl: string; receiptHandle: string }): Promise<void>;
}

class AwsSqsInputClient implements SqsInputClient {
  private readonly client: SQSClient;

  constructor(region: string) {
    this.client = new SQSClient({ region });
  }

  async receiveOne(params: {
    queueUrl: string;
    waitTimeSeconds: number;
    visibilityTimeoutSeconds: number;
  }): Promise<PolledSqsMessage | null> {
    const command = new ReceiveMessageCommand({
      QueueUrl: params.queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: params.waitTimeSeconds,
      VisibilityTimeout: params.visibilityTimeoutSeconds,
      AttributeNames: ["All"],
    });
    const response = await this.client.send(command);
    const message = response.Messages?.[0];
    if (!message?.Body || !message.ReceiptHandle) {
      return null;
    }
    return {
      body: message.Body,
      messageId: message.MessageId,
      receiptHandle: message.ReceiptHandle,
    };
  }

  async deleteMessage(params: { queueUrl: string; receiptHandle: string }): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: params.queueUrl,
        ReceiptHandle: params.receiptHandle,
      })
    );
  }
}

export function createSqsInputClient(region: string): SqsInputClient {
  return new AwsSqsInputClient(region);
}
