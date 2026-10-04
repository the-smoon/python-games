/** Feed existing combat browser tests through the real playlist picker instead of removed local inputs. */
export async function selectMockPlaylist(page, files) {
  const tracks = files.map((file, i) => ({ id: `fixture-${i}`, title: file.name, size: file.buffer.length }));
  await page.route('**/api/playlists**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/owner')) return route.fulfill({ json: { owner: false, configured: false } });
    if (path.endsWith('/library')) return route.fulfill({ json: tracks });
    if (path.includes('/audio/')) {
      const i = Number(path.split('/').pop().split('-').pop()), bytes = files[i].buffer;
      return route.fulfill({ contentType: 'audio/mpeg', headers: { 'content-length': String(bytes.length) }, body: bytes });
    }
    return route.fulfill({ json: [] });
  });
  await page.reload();
  for (const track of tracks) {
    await page.getByTestId(`button-add-${track.id}`).click();
    await page.getByTestId(`button-remove-${track.id}`).waitFor();
  }
}