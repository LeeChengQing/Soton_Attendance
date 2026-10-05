const MIN_SUBMIT_DELAY_SECONDS = 15;
const MAX_SUBMIT_DELAY_SECONDS = 20;

export function randomSubmitDelay(random = Math.random) {
  const seconds = MIN_SUBMIT_DELAY_SECONDS + Math.min(
    MAX_SUBMIT_DELAY_SECONDS - MIN_SUBMIT_DELAY_SECONDS,
    Math.floor(random() * (MAX_SUBMIT_DELAY_SECONDS - MIN_SUBMIT_DELAY_SECONDS + 1)),
  );
  return seconds * 1000;
}
