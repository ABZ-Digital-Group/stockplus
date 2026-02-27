function deleteStock(){
    var queryDelete = document.getElementById("id_delete");
    db.collection("stock").deleteOne(queryDelete, function(err, obj){
        if (err) throw err;
        res.render('pages/stock')
    });
}