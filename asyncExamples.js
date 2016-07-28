// SO. How do we make a synchronous CPU-intensive thing asynchronous and not introduce a race condition?

// Let's look at some examples. All we are going to be doing is creating an array of random numbers,
// but doing so in different ways, to illustrate some of the common misconceptions around callbacks and
// asynchronous behaviour in NodeJs.
// The sizes of the arrays we will create is the value of COUNT:

var COUNT = 100000;

// totally synchronous, no attempt to be asynchronous or use callbacks, except in the use of a final callback,
// which is called synchronously.
function genRandomArraySync(count, cb) {

  function getRandomNumber() {
    return Math.random();
  }
  var array=[];
  for (var i = 0; i < count; i++){
    array.push(getRandomNumber());
  }
  cb(null, array);
}


// Uses even more callbacks, which looks like it might be asynchronous, but isn't really.
function genRandomArrayConfused(count, cb) {

  function getRandomNumber(cb) {
    cb(null, Math.random());
  }

  var array=[];
  for (var i = 0; i < count; i++){
    getRandomNumber(function(error, number) {
      array.push(number);
    });
  }

  cb(null, array);

}

// Now, we are forcing the behaviour to be asynchronous, by making the creation of a random number happen in the nextTick.
// Better? Not really... Yes are forcing the getRandomNumber to be asynchronous, but there's a problem....
function genRandomArrayAsyncRace(count, cb) {

  function getRandomNumber(cb) {
    process.nextTick(function() {
      cb(null, Math.random());
    });
  }

  var array=[];
  for (var i = 0; i < count; i++){
    getRandomNumber(function(error, number) {
      array.push(number);
    });
  }

  // ... we have now introduced a race condition - the call back below will happen after the for-loop has finished,
  // BUT, there may be some getGetRandomNumber invocations that are still pending. Actually, they all will. :(
  cb(null, array);
}


// So let's write a little harness to test all this, and provide some timings....
var timings = {};
function testHarness(fn, count, cb) {
  var start = new Date().getTime();
  fn(count, function(error, array) {
    var end = new Date().getTime();
    timings[fn.name] = {duration: end-start, count: array.length};
    cb(null, timings[fn.name], array);
  });
}

// ...and invoke the harness on all out functions.
testHarness(genRandomArraySync, COUNT, function(error, results, array) {
  testHarness(genRandomArrayConfused, COUNT, function(error, results, array) {
    testHarness(genRandomArrayAsyncRace, COUNT, function(error, results, array) {
      console.log('timings: ', JSON.stringify(timings, null, 2));
      console.log('async array length on callback: ', array.length);
      setTimeout(function() {
        console.log('async array length after timeout (showing race condition): ', array.length)
      }, 10);

      // Typical output:
      // timings:  {
      //   "genRandomArraySync": {
      //     "duration": 2,
      //       "count": 10000
      //   },
      //   "genRandomArrayConfused": {
      //     "duration": 2,
      //       "count": 10000
      //   },
      //   "genRandomArrayAsyncRace": {
      //     "duration": 5,
      //       "count": 0
      //   }
      // }
      // async array length on callback:  0
      // async array length after timeout (showing race condition):  10000

    });
  });
});

// So how do we get around this?
// We can use the async library.
// On the command line:  npm install async
var async = require('async');
// The async library is designed to allow a set of asynchronous tasks to be run in series or in parallel.
// But it can be used for so much more too.
// For example... the above set of nested testHarness functions can now be written like so:

// Reset the timings
timings = {};
async.eachSeries(
  [genRandomArraySync, genRandomArrayConfused, genRandomArrayAsyncRace],
  function(fn, next) {
    testHarness(fn, COUNT, next);
  },
  function(error) {
    console.log('timings #2: ', JSON.stringify(timings, null, 2));
  });

// But more importantly, we can eliminate the race condition:

function genRandomArrayAsyncNoRace(count, cb) {

  function getRandomNumber(cb) {
    process.nextTick(function() {
      cb(null, Math.random());
    });
  }

  var array=[];

  async.whilst(function() {return array.length < count},
    function(next) {
      getRandomNumber(function(error, number) {
        array.push(number);
        next();
      });
    },
    function(error) {
      cb(error, array);
    });

}

// Reset the timings
timings = {};
async.eachSeries(
  [genRandomArraySync, genRandomArrayConfused, genRandomArrayAsyncRace, genRandomArrayAsyncNoRace],
  function(fn, next) {
    testHarness(fn, COUNT, next);
  },
  function(error) {
    console.log('timings #3: ', JSON.stringify(timings, null, 2));
  });


// Why bother?
// Because of the single threaded event-loop.
// If we tie up the event loop for too long, we stop other things from running, like I/O operations that are ready,
// or other functions that are asynchronous.
// By making things asynchronous like this, we allow NodeJS to pipe-line operations:
// each tick of the event-loop can be progressing many different operations.
// And if one operation took longer, then it wouldn't slow the other's down.
// Consider for example two REST API calls, one to process a 100,000 line document, followed by another to process a 1,000 line document.
// If the document was processed synchronously (e.g. a simple for-loop, going through each line in a synchronous way),
// the 1,000 line document would not begin being processed until the 100,000 line document was done.
// However, by breaking down the processing of the document to be asynchronous per line,
// the 1,000 line document can be processed 'in parallel' to the 100,000 line document
// (yes, even though Node is single threaded),and return with a response as soon as it is done.
//
