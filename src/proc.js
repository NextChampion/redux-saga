import { is, check, TASK } from './utils'
import { as, matcher } from './io'

export const NOT_ITERATOR_ERROR = "proc first argument (Saga function result) must be an iterator"

export default function proc(iterator, subscribe=()=>()=>{}, dispatch=()=>{}) {

  check(iterator, is.iterator, NOT_ITERATOR_ERROR)

  let deferredInput, deferredEnd
  const canThrow = is.throw(iterator)

  const endP = new Promise((resolve, reject) => deferredEnd = {resolve, reject})

  const unsubscribe = subscribe(input => {
    if(deferredInput && deferredInput.match(input))
      deferredInput.resolve(input)
  })

  next()
  iterator._isRunning = true
  return endP

  function next(arg, isError) {
    //console.log('next', arg, isError)
    deferredInput = null
    try {
      if(isError && !canThrow)
        throw arg
      const result = isError ? iterator.throw(arg) : iterator.next(arg)

      if(!result.done) {
        //console.log('yield', name, result.value)
        runEffect(result.value).then(next, err => next(err, true))
      } else {
        //console.log('return', name, result.value)
        iterator._isRunning = false
        iterator._result = result.value
        unsubscribe()
        deferredEnd.resolve(result.value)
      }
    } catch(err) {
      //console.log('catch', name, err)
      iterator._isRunning = false
      iterator._error = err
      unsubscribe()
      deferredEnd.reject(err)
    }
  }

  function runEffect(effect) {
    let data
    return (
        is.array(effect)           ? Promise.all(effect.map(runEffect))
      : is.iterator(effect)        ? proc(effect, subscribe, dispatch)

      : (data = as.take(effect))   ? runTakeEffect(data)
      : (data = as.put(effect))    ? runPutEffect(data)
      : (data = as.race(effect))   ? runRaceEffect(data)
      : (data = as.call(effect))   ? runCallEffect(data.fn, data.args)
      : (data = as.cps(effect))    ? runCPSEffect(data.fn, data.args)
      : (data = as.fork(effect))    ? runForkEffect(data.task, data.args)
      : (data = as.join(effect))    ? runJoinEffect(data)

      : /* resolve anything else  */ Promise.resolve(effect)
    )
  }

  function runTakeEffect(pattern) {
    return new Promise(resolve => {
      deferredInput = { resolve, match : matcher(pattern), pattern }
    })
  }

  function runPutEffect(action) {
    return Promise.resolve(1).then(() => dispatch(action) )
  }

  function runCallEffect(fn, args) {
    const result = fn(...args)
    return !is.iterator(result)
      ? Promise.resolve(result)
      : proc(result, subscribe, dispatch)
  }

  function runCPSEffect(fn, args) {
    return new Promise((resolve, reject) => {
      fn(...args.concat(
        (err, res) => is.undef(err) ? resolve(res) : reject(err)
      ))
    })
  }

  function runForkEffect(task, args) {
    let result, _generator, _iterator
    const isFunc = is.func(task)

    // we run the function, next we'll check if this is a generator function
    // (generator is a function that returns an iterator)
    if(isFunc)
      result = task(...args)

    // A generator function: i.e. returns an iterator
    if( is.iterator(result) ) {
      _generator = task
      _iterator = result
    }
    // directly forking an iterator
    else if(is.iterator(task)) {
      _iterator = task
    }
    //simple effect: wrap in a generator
    else {
      _iterator = function*() {
        return ( yield isFunc ? result : task )
      }()
    }

    const _done = proc(_iterator, subscribe, dispatch)

    const taskDesc = {
      [TASK]: true,
      _generator,
      _iterator,
      _done,
      name : isFunc ? task.name : 'anonymous',
      isRunning: () => _iterator._isRunning,
      result: () => _iterator._result,
      error: () => _iterator._error
    }
    return Promise.resolve(taskDesc)
  }

  function runJoinEffect(task) {
    return task._done
  }

  function runRaceEffect(effects) {
    return Promise.race(
      Object.keys(effects)
      .map(key =>
        runEffect(effects[key])
        .then( result => ({ [key]: result }),
               error  => Promise.reject({ [key]: error }))
      )
    )
  }
}
