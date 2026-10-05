import test from 'node:test';
import assert from 'node:assert/strict';
import {sameProfile} from '../src/profile.js';
test('Chrome storage field order does not make a saved student profile dirty',()=>{
  const saved={name:'Student',student:'123',studentType:'local'};
  const form={student:'123',name:'Student',studentType:'local'};
  assert.equal(sameProfile(saved,form),true);
  assert.equal(sameProfile({...saved,metadata:'old'},form),true);
});
test('profile matching normalizes edge whitespace and legacy local identity but detects real edits',()=>{
  const saved={student:' 123 ',name:'Student '};
  assert.equal(sameProfile(saved,{student:'123',name:'Student',studentType:'local'}),true);
  for(const patch of [{student:'456'},{name:'Changed'},{studentType:'international'}]) assert.equal(sameProfile({student:'123',name:'Student',studentType:'local'},{student:'123',name:'Student',studentType:'local',...patch}),false);
});
