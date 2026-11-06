import { beforeEach, describe, expect, it, vi } from "vitest";

// Scripted fake of the kafkajs producer: `events` emulates its real behaviour of
// emitting CONNECT on connect, and nothing at all when a broker dies.
const fake = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  return {
    handlers,
    connect: vi.fn(async () => handlers.get("connect")?.()),
    disconnect: vi.fn(async () => {}),
    send: vi.fn(async (_: { messages: unknown[] }) => {}),
  };
});

vi.mock("../../src/kafka/client.js", () => ({
  kafka: {
    producer: () => ({
      events: { CONNECT: "connect" },
      on: (event: string, handler: () => void) => fake.handlers.set(event, handler),
      connect: fake.connect,
      disconnect: fake.disconnect,
      send: fake.send,
    }),
  },
}));

import {
  enqueueForKafka,
  flushKafkaNow,
  getKafkaHealth,
  startProducer,
  stopProducer,
} from "../../src/kafka/producer.js";
import type { RequestFeatures } from "../../src/proxy/extractor.js";

const feature = (requestId: string) => ({ requestId, tenantId: "t" }) as RequestFeatures;

const sentIds = () =>
  fake.send.mock.calls.flatMap(([{ messages }]) =>
    (messages as { value: string }[]).map((m) => JSON.parse(m.value).requestId as string),
  );

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("Kafka producer under broker failure", () => {
  beforeEach(async () => {
    await stopProducer();
    fake.send.mockReset();
    fake.send.mockImplementation(async () => {});
    fake.connect.mockImplementation(async () => fake.handlers.get("connect")?.());
    startProducer();
    await settle();
    await flushKafkaNow(); // Clears anything left by an earlier test.
    fake.send.mockClear();
  });

  it("does not block or throw when enqueueing with no connection", async () => {
    await stopProducer();
    fake.connect.mockRejectedValue(new Error("broker down"));
    startProducer();
    await settle();
    expect(getKafkaHealth().status).toBe("disconnected");
    expect(() => enqueueForKafka(feature("a"))).not.toThrow();
    expect(fake.send).not.toHaveBeenCalled();
  });

  it("notices a lost broker from a failed send, and reports disconnected", async () => {
    expect(getKafkaHealth().status).toBe("connected");
    fake.connect.mockRejectedValue(new Error("broker down"));
    fake.send.mockRejectedValueOnce(new Error("broker gone"));

    enqueueForKafka(feature("lost-broker"));
    await flushKafkaNow();
    await settle();

    expect(getKafkaHealth().status).toBe("disconnected");
    expect(fake.disconnect).toHaveBeenCalled();
  });

  it("keeps the failed batch and delivers it, in order, after reconnecting", async () => {
    fake.send.mockRejectedValueOnce(new Error("broker gone"));
    enqueueForKafka(feature("first"));
    enqueueForKafka(feature("second"));
    await flushKafkaNow();
    await settle(); // Reconnects: the fake connect succeeds.
    expect(getKafkaHealth().status).toBe("connected");

    enqueueForKafka(feature("third"));
    fake.send.mockClear();
    await flushKafkaNow();

    expect(sentIds()).toEqual(["first", "second", "third"]);
    expect(getKafkaHealth().buffered).toBe(0);
  });

  it("caps the buffer by dropping the oldest messages", async () => {
    await stopProducer();
    fake.connect.mockRejectedValue(new Error("broker down"));
    startProducer();
    await settle();

    for (let i = 0; i < 10_050; i++) enqueueForKafka(feature(`m${i}`));
    expect(getKafkaHealth().buffered).toBe(10_000);
  });

  it("does not hang on shutdown when the broker is down", async () => {
    await stopProducer();
    fake.connect.mockRejectedValue(new Error("broker down"));
    startProducer();
    await settle();
    enqueueForKafka(feature("stuck"));

    const started = Date.now();
    await stopProducer();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
