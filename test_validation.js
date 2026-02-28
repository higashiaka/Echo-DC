const { checkGallery } = require('./electron/crawler/galleryHelper')
const axios = require('axios')

async function test() {
    const gallId = 'programming'
    const gallType = 0
    const baseUrl = `https://gall.dcinside.com/board/lists?id=${gallId}`
    const url = `${baseUrl}&page=1`

    console.log(`Testing URL: ${url}`)

    try {
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://gall.dcinside.com/'
            },
            timeout: 10000
        })
        console.log('Status:', res.status)
        console.log('Data Length:', res.data ? res.data.length : 0)
        console.log('Data Snippet:', res.data ? res.data.substring(0, 100) : 'EMPTY')

        const resCheck = await checkGallery(gallId, gallType)
        console.log('CheckGallery Result:', resCheck)
    } catch (e) {
        console.error('Error:', e.message)
        if (e.response) {
            console.error('Response Status:', e.response.status)
            console.error('Response Data:', e.response.data)
        }
    }
}

test()
