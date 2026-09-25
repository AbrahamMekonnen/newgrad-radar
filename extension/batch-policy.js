(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;root.HireRadarBatchPolicy=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const capacity = (state = {}, maximum = 7) => {
    if (state.canaryFailed) return 0;
    const completed = Number(state.canaryCompleted || 0);
    return completed < 1 ? 1 : completed < 4 ? Math.min(3, maximum) : maximum;
  };
  const outcome = (state = {}, stage) => stage === 'failed'
    ? { ...state, canaryFailed: true }
    : { ...state, canaryCompleted: Number(state.canaryCompleted || 0) + 1 };
  return { capacity, outcome };
});