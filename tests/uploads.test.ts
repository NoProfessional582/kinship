import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { localPhotoName, photoPath, ownerUploadDir } from '@/lib/uploads'

const NAME = '12345678-1234-1234-1234-123456789abc.png'
describe('local photo references', () => {
  it('keeps UUID URLs and ignores external photos', () => {
    expect(localPhotoName(`/uploads/${NAME}`)).toBe(NAME)
    for (const value of [null, '', 'https://example.test/uploads/a.png', '//example.test/a.png'])
      expect(localPhotoName(value)).toBeNull()
  })
  it.each(['../a.png', '%2e%2e/a.png', `${NAME}?x=1`, `${NAME}/child`, 'legacy.png', '/tmp/a.png'])(
    'rejects unsafe local name %s',
    (name) => {
      expect(() => localPhotoName(`/uploads/${name}`)).toThrow(/Invalid local photo reference/)
      expect(() => photoPath('owner', name)).toThrow(/Invalid stored photo name/)
    },
  )
  it('uses the physical container upload root for the packaged CLI', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/app/cli')
    vi.resetModules()
    try {
      const cli = await import('@/lib/uploads')
      expect(cli.UPLOAD_DIR).toBe('/app/public/uploads')
      expect(cli.ownerUploadDir('owner')).toBe(
        path.join('/app/public/uploads', path.basename(ownerUploadDir('owner'))),
      )
    } finally {
      cwd.mockRestore()
      vi.resetModules()
    }
  })
  it('confines valid names to a hashed owner directory', () => {
    expect(path.dirname(photoPath('../../outside', NAME))).toBe(ownerUploadDir('../../outside'))
    expect(photoPath('a', NAME)).not.toBe(photoPath('b', NAME))
  })
})
