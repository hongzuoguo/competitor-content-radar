const MAX_FETCH_ATTEMPTS = 3
const RETRY_DELAY_MS = 100

export function createTransportRetryFetcher(fetchImplementation: typeof fetch) {
  let attempts = 0

  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    for (;;) {
      attempts += 1
      try {
        return await fetchImplementation(input, init)
      } catch (error) {
        if (attempts >= MAX_FETCH_ATTEMPTS) throw error
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      }
    }
  }
}
