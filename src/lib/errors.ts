/**
 * The status codes in this application are stated by the rules, not chosen by the code:
 * MR-PLT-02 fixes 401 and 403, MR-REV-03 and MR-STO-06 fix 409, MR-REV-01 and MR-REV-06 fix
 * 422. Throwing a typed error keeps the code the rule states next to the check the rule
 * describes, instead of at the bottom of a handler.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const unauthorized = (message = 'Sign in required') =>
  new ApiError(401, 'unauthorized', message);

export const forbidden = (message = 'Not permitted') => new ApiError(403, 'forbidden', message);

export const conflict = (message: string) => new ApiError(409, 'conflict', message);

export const unprocessable = (message: string) => new ApiError(422, 'unprocessable', message);

export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message);

/**
 * Runs a handler and turns an ApiError into a response.
 *
 * MR-PLT-02 requires that a refused request change no state and return no record data the
 * caller was not entitled to read, so the body here is a code and a message and never a
 * record. Anything that is not an ApiError is a genuine fault and is left to propagate.
 */
export async function respond(handler: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }
}
