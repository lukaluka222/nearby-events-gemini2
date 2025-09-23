module.exports=(req,res)=>{res.statusCode=200;res.setHeader('Content-Type','application/json; charset=utf-8');res.end('{"ok":true,"msg":"events handler is alive"}');};
