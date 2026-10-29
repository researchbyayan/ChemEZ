import {describe,it,expect} from 'vitest';
import {errorMessage} from './errors';

describe('error categories',()=>{
  it('does not mislabel invalid chemistry or images as rejected API keys',()=>{
    expect(errorMessage('Invalid molecular structure.')).toBe('Invalid molecular structure.');
    expect(errorMessage('Invalid image data.')).toBe('Invalid image data.');
    expect(errorMessage('The provider rejected the API key.')).toContain('didn’t accept this key');
  });
});
