import {mergeAttributes} from '@tiptap/core'
import {DOMSerializer, Schema} from '@tiptap/pm/model'

globalThis.verifyTiptapAttributes = () => {
  const input = JSON.parse(
    '{"__proto__":{"data-inherited-canary":"present","src":"x-invalid://canary","onerror":"globalThis.__tiptapXss += 1"}}',
  )
  const attributes = mergeAttributes(input)
  const schema = new Schema({
    nodes: {
      doc: {content: 'image'},
      image: {toDOM: () => ['img', attributes]},
      text: {},
    },
  })
  const doc = schema.node('doc', null, [schema.node('image')])
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(
    doc.content,
  )
  const image = fragment.firstChild
  const descriptor = Object.getOwnPropertyDescriptor(attributes, '__proto__')
  return {
    ordinaryPrototype: Object.getPrototypeOf(attributes) === Object.prototype,
    keys: Object.keys(attributes),
    ownDataProperty:
      !!descriptor &&
      descriptor.value === input.__proto__ &&
      descriptor.get === undefined &&
      descriptor.set === undefined,
    inheritedCanary: attributes['data-inherited-canary'],
    handler: image.getAttribute('onerror'),
    source: image.getAttribute('src'),
    canary: image.getAttribute('data-inherited-canary'),
  }
}
