export function errorMessage(error:unknown){
  const text=(error instanceof Error?error.message:String(error)).replace(/^Error invoking remote method '[^']+': Error: /,'').replace(/^Error: /,'');
  if(/503|502|temporarily unavailable/.test(text))return 'The service is busy right now. Your key hasn’t been deleted—wait a moment and try again.';
  if(/(?:invalid|expired|rejected|not valid).{0,35}(?:api\s*)?key|(?:api\s*)?key.{0,35}(?:invalid|expired|rejected|not valid)/i.test(text))return 'That service didn’t accept this key. Paste an active key from the provider selected in settings.';
  return text;
}
