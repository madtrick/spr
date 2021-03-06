'use strict';

var gulp  = require('gulp');
var mocha = require('gulp-mocha');

gulp.task('test', function () {
  return gulp.src('tests/**_tests.js', {read: false})
          .pipe(mocha({reporter: 'nyan'}));
});
