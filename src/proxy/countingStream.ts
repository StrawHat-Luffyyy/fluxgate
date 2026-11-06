/**
 * Passes a body through unchanged while counting bytes. `onDone` runs once, whether
 * the stream finished, failed, or the reader went away.
 */
export const countingStream = (
  body: ReadableStream<Uint8Array>,
  onDone: (bytes: number) => void,
): ReadableStream<Uint8Array> => {
  const reader = body.getReader();
  let bytes = 0;
  let finished = false;
  const finish = () => {
    if (!finished) {
      finished = true;
      onDone(bytes);
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
          return;
        }
        bytes += value.byteLength;
        controller.enqueue(value);
      } catch (err) {
        finish();
        controller.error(err);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason);
    },
  });
};
