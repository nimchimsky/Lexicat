/** Error amb codi HTTP associat, per als handlers de ruta. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

