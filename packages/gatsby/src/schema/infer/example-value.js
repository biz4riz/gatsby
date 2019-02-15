const _ = require(`lodash`)
const is32BitInteger = require(`./is-32-bit-integer`)
const { isDate } = require(`../types/date`)

const getExampleValue = ({
  nodes,
  typeName,
  typeConflictReporter,
  ignoreFields,
}) => {
  const exampleValue = getExampleObject({
    nodes,
    prefix: typeName,
    typeConflictReporter,
    ignoreFields,
  })
  return exampleValue
}

module.exports = {
  getExampleValue,
}

const getExampleObject = ({
  nodes,
  prefix,
  typeConflictReporter,
  ignoreFields = [],
}) => {
  const allKeys = nodes.reduce(
    (acc, node) =>
      Object.keys(node).forEach(
        key => key && !ignoreFields.includes(key) && acc.add(key)
      ) || acc,
    new Set()
  )

  const exampleValue = Array.from(allKeys).reduce((acc, key) => {
    const entries = nodes
      .map(node => {
        const value = node[key]
        const type = getType(value)
        return type && { value, type, parent: node }
      })
      .filter(Boolean)

    const selector = prefix ? `${prefix}.${key}` : key

    const entriesByType = _.uniqBy(entries, entry => entry.type)
    if (!entriesByType.length) return acc

    // TODO: This whole thing could be prettier!

    let { value, type } = entriesByType[0]
    let arrayWrappers = 0
    while (Array.isArray(value)) {
      value = value[0]
      arrayWrappers++
    }

    if (entriesByType.length > 1 || type.includes(`,`)) {
      typeConflictReporter.addConflict(selector, entriesByType)
      return acc
    }

    let exampleFieldValue
    if (_.isPlainObject(value)) {
      const objects = entries.reduce((acc, entry) => {
        let { value } = entry
        let arrays = arrayWrappers - 1
        while (arrays-- > 0) value = value[0]
        return acc.concat(value)
      }, [])
      const exampleObject = getExampleObject({
        nodes: objects,
        prefix: selector,
        typeConflictReporter,
      })
      if (!Object.keys(exampleObject).length) return acc
      exampleFieldValue = exampleObject
    } else if (key.includes(`___NODE`) && arrayWrappers) {
      // For arrays on ___NODE foreign-key fields we return all values,
      // because the array values are allowed to link to nodes of different types.
      // For those we will create a GraphQLUnionType later.
      arrayWrappers--
      exampleFieldValue = entries.reduce(
        (acc, entry) => acc.concat(entry.value),
        []
      )
    } else {
      // FIXME: Why not simply treat every number as float (instead of looping through all values again)?
      exampleFieldValue =
        (typeof value === `number` && findFloat(entries)) || value
      // exampleFieldValue = value === `number` ? 0.1 : value
    }
    while (arrayWrappers--) {
      exampleFieldValue = [exampleFieldValue]
    }
    acc[key] = exampleFieldValue

    return acc
  }, {})

  return exampleValue
}

const findFloat = entries => {
  let result
  const find = numbers =>
    numbers.some(value => {
      const number = typeof value === `object` ? value.value : value
      return Array.isArray(number)
        ? find(number)
        : !is32BitInteger(number) && (result = number)
    })
  find(entries)
  return result
}

const getType = value => {
  switch (typeof value) {
    case `number`:
      return `number`
    case `string`:
      return isDate(value) ? `date` : `string`
    case `boolean`:
      return `boolean`
    case `object`:
      if (value === null) return null
      if (value instanceof Date) return `date`
      if (value instanceof String) return `string`
      if (Array.isArray(value)) {
        const uniqueValues = _.uniq(value.map(getType).filter(v => v != null))
        return uniqueValues.length ? `[${uniqueValues.join(`,`)}]` : null
      }
      if (!Object.keys(value).length) return null
      return `object`
    default:
      return null
  }
}
