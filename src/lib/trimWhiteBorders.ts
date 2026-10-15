/** Crop pure-white and transparent padding from a loaded image. */
export async function trimWhiteBorders(
  img: HTMLImageElement,
  tolerance = 6,
): Promise<string | null> {
  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!width || !height) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(img, 0, 0, width, height)

  let imageData: ImageData
  try {
    imageData = context.getImageData(0, 0, width, height)
  } catch {
    return null
  }

  const data = imageData.data
  const rgbThreshold = 255 * 3 - tolerance * 3
  const isContent = (index: number) =>
    data[index + 3] >= 10 &&
    data[index] + data[index + 1] + data[index + 2] < rgbThreshold

  let top = 0
  outerTop: for (; top < height; top++) {
    for (let x = 0; x < width; x++) {
      if (isContent((top * width + x) * 4)) break outerTop
    }
  }
  let bottom = height - 1
  outerBottom: for (; bottom > top; bottom--) {
    for (let x = 0; x < width; x++) {
      if (isContent((bottom * width + x) * 4)) break outerBottom
    }
  }
  let left = 0
  outerLeft: for (; left < width; left++) {
    for (let y = top; y <= bottom; y++) {
      if (isContent((y * width + left) * 4)) break outerLeft
    }
  }
  let right = width - 1
  outerRight: for (; right > left; right--) {
    for (let y = top; y <= bottom; y++) {
      if (isContent((y * width + right) * 4)) break outerRight
    }
  }

  if (top === 0 && left === 0 && bottom === height - 1 && right === width - 1) {
    return null
  }

  const cropWidth = right - left + 1
  const cropHeight = bottom - top + 1
  if (cropWidth <= 0 || cropHeight <= 0) return null

  const output = document.createElement('canvas')
  output.width = cropWidth
  output.height = cropHeight
  const outputContext = output.getContext('2d')
  if (!outputContext) return null
  outputContext.imageSmoothingQuality = 'high'
  outputContext.drawImage(
    canvas,
    left,
    top,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  )
  return output.toDataURL('image/png')
}