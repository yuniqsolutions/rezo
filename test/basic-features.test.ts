/**
 * Basic test suite for merged features from uniqhtt into Rezo
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Cookie, CookieJar, RezoFormData } from '../src';

describe('Basic Features Tests', () => {
  describe('Cookie Management', () => {
    it('should create and manage cookies', () => {
      const cookie = new Cookie({
        key: 'test',
        value: 'value123',
        domain: 'example.com',
        path: '/',
        secure: true
      });

      expect(cookie.key).toBe('test');
      expect(cookie.value).toBe('value123');
      expect(cookie.domain).toBe('example.com');
      expect(cookie.secure).toBe(true);
    });

    it('should create cookie jar', () => {
      const jar = new CookieJar();
      expect(jar).toBeInstanceOf(CookieJar);
    });
  });

  describe('Form Data Handling', () => {
    it('should create and manage form data', () => {
      const formData = new RezoFormData();
      
      formData.append('name', 'John Doe');
      formData.append('email', 'john@example.com');
      
      expect(formData.has('name')).toBe(true);
      expect(formData.get('name')).toBe('John Doe');
      
      const contentType = formData.getContentType();
      expect(contentType).toContain('multipart/form-data');
      expect(contentType).toContain('boundary=');
    });

    it('should create URL-encoded form data', () => {
      const data = {
        name: 'John Doe',
        city: 'New York'
      };
      
      const encoded = RezoFormData.createUrlEncoded(data);
      expect(encoded).toContain('name=John+Doe');
      expect(encoded).toContain('city=New+York');
    });
  });
});